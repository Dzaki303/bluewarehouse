"""Model (OOP) untuk data master, user, audit log, dan kartu stok."""
import re
from pymongo.errors import DuplicateKeyError
from werkzeug.security import generate_password_hash, check_password_hash
from .core import AppError, now, oid, serialize
from .database import Database

ROLES = ("admin", "manager", "staff", "supplier")   # supplier: akun portal supplier (bukan pengguna WMS)


class AuditLog:
    @staticmethod
    def log(actor, action, entity, ref=None, detail="", session=None):
        Database.col("audit_logs").insert_one({
            "at": now(),
            "user": actor["username"] if actor else "system",
            "role": actor["role"] if actor else "system",
            "action": action,
            "entity": entity,
            "ref": str(ref) if ref is not None else "",
            "detail": str(detail)[:300],
        }, session=session)

    @staticmethod
    def find(limit=500):
        return serialize(list(Database.col("audit_logs").find().sort("at", -1).limit(limit)))


class BaseModel:
    """Basis CRUD generik: validasi field, audit log, hook before_update / before_delete."""
    collection = ""
    label = "Data"
    fields = {}          # nama -> {type, required, default, min}
    sort = [("created_at", -1)]

    @classmethod
    def col(cls):
        return Database.col(cls.collection)

    @classmethod
    def clean(cls, data, partial=False):
        out = {}
        for name, spec in cls.fields.items():
            if name in data:
                v = data[name]
                if v is None or v == "":
                    v = spec.get("default")
                else:
                    try:
                        v = spec["type"](v)
                    except (ValueError, TypeError):
                        raise AppError(f"Field '{name}' tidak valid")
                    if isinstance(v, str):
                        v = v.strip()
                out[name] = v
            elif not partial and "default" in spec:
                out[name] = spec["default"]
            if spec.get("required") and (not partial or name in data) and out.get(name) in (None, ""):
                raise AppError(f"Field '{name}' wajib diisi")
            if "min" in spec and out.get(name) is not None and out[name] < spec["min"]:
                raise AppError(f"Field '{name}' minimal {spec['min']}")
        return out

    @classmethod
    def defaults(cls):
        return {}

    @classmethod
    def describe(cls, doc):
        return doc.get("name") or doc.get("code") or doc.get("username") or ""

    @classmethod
    def find_all(cls, flt=None):
        return serialize(list(cls.col().find(flt or {}).sort(cls.sort)))

    @classmethod
    def get(cls, rid):
        doc = cls.col().find_one({"_id": oid(rid)})
        if not doc:
            raise AppError(f"{cls.label} tidak ditemukan", 404)
        return doc

    @classmethod
    def create(cls, data, actor):
        doc = cls.clean(data)
        doc.update(cls.defaults())
        doc["created_at"] = now()
        try:
            cls.col().insert_one(doc)
        except DuplicateKeyError:
            raise AppError(f"{cls.label} sudah ada (data duplikat)", 409)
        AuditLog.log(actor, "create", cls.collection, doc["_id"], cls.describe(doc))
        return doc

    @classmethod
    def before_update(cls, current, changes, actor):
        pass

    @classmethod
    def update(cls, rid, data, actor):
        current = cls.get(rid)
        changes = cls.clean(data, partial=True)
        cls.before_update(current, changes, actor)
        changes["updated_at"] = now()
        try:
            cls.col().update_one({"_id": current["_id"]}, {"$set": changes})
        except DuplicateKeyError:
            raise AppError(f"{cls.label} sudah ada (data duplikat)", 409)
        AuditLog.log(actor, "update", cls.collection, current["_id"], cls.describe({**current, **changes}))
        return cls.get(rid)

    @classmethod
    def before_delete(cls, doc, actor):
        pass

    @classmethod
    def delete(cls, rid, actor):
        doc = cls.get(rid)
        cls.before_delete(doc, actor)
        cls.col().delete_one({"_id": doc["_id"]})
        AuditLog.log(actor, "delete", cls.collection, doc["_id"], cls.describe(doc))


class Category(BaseModel):
    collection, label, sort = "categories", "Kategori", [("name", 1)]
    fields = {"name": {"type": str, "required": True}, "description": {"type": str, "default": ""}}

    @classmethod
    def before_delete(cls, doc, actor):
        if Item.col().count_documents({"category": doc["name"]}):
            raise AppError("Kategori masih dipakai oleh barang", 409)


class Warehouse(BaseModel):
    collection, label, sort = "warehouses", "Warehouse", [("name", 1)]
    fields = {"name": {"type": str, "required": True}, "address": {"type": str, "default": ""}}

    @classmethod
    def before_delete(cls, doc, actor):
        if Item.col().count_documents({"warehouse": doc["name"]}):
            raise AppError("Warehouse masih dipakai oleh barang", 409)


class Supplier(BaseModel):
    """Supplier = pihak luar yang sudah memiliki daftar produk dan harga. Admin hanya menginput data supplier dan
    daftar produknya di sini (menggantikan data dari pihak supplier); barang di sistem didaftarkan dari produk ini.
    products: [{sku, name, unit, price}]"""
    collection, label, sort = "suppliers", "Supplier", [("name", 1)]
    fields = {
        "name": {"type": str, "required": True},
        "contact": {"type": str, "default": ""},
        "phone": {"type": str, "default": ""},
        "email": {"type": str, "default": ""},
        "address": {"type": str, "default": ""},
    }

    @staticmethod
    def product(supplier, sku):
        return next((p for p in (supplier or {}).get("products", []) if p.get("sku") == sku), None)

    @classmethod
    def clean(cls, data, partial=False):
        out = super().clean(data, partial)
        if "products" in data or not partial:     # update tanpa field products tidak mengubah daftar produk
            out["products"] = cls._clean_products(data.get("products"))
        return out

    @staticmethod
    def _clean_products(raw):
        if raw in (None, ""):
            return []
        if not isinstance(raw, list):
            raise AppError("Daftar produk supplier tidak valid")
        out, seen = [], set()
        for i, p in enumerate(raw, start=1):
            p = p or {}
            sku, name = str(p.get("sku") or "").strip(), str(p.get("name") or "").strip()
            if not sku or not name:
                raise AppError(f"Produk ke-{i}: SKU dan nama wajib diisi")
            if sku in seen:
                raise AppError(f"SKU {sku} terdaftar dua kali")
            try:
                price = float(p.get("price"))
            except (TypeError, ValueError):
                raise AppError(f"Produk {sku}: harga harus berupa angka")
            if price < 0:
                raise AppError(f"Produk {sku}: harga tidak boleh negatif")
            seen.add(sku)
            out.append({"sku": sku, "name": name, "unit": str(p.get("unit") or "pcs").strip() or "pcs", "price": price})
        return out

    @classmethod
    def import_json(cls, raw, actor):
        """Import satu atau banyak supplier beserta produk dan harga dari JSON.
        Supplier baru ditambahkan; supplier yang namanya sudah ada diperbarui: produk dengan sku sama diperbarui,
        sku baru ditambahkan, produk lain tidak dihapus. Seluruh data divalidasi dulu sebelum ada yang disimpan."""
        if isinstance(raw, dict):
            raw = [raw]
        if not isinstance(raw, list) or not raw:
            raise AppError("JSON harus berisi satu supplier atau daftar supplier")
        siap = []
        for i, s in enumerate(raw, start=1):
            if not isinstance(s, dict):
                raise AppError(f"Supplier ke-{i}: harus berupa objek JSON")
            name = str(s.get("name") or "").strip()
            if not name:
                raise AppError(f"Supplier ke-{i}: field name wajib diisi")
            try:
                products = cls._clean_products(s.get("products"))
            except AppError as e:
                raise AppError(f"Supplier {name}: {e.message}")
            siap.append((name, s, products))
        hasil = {"ditambahkan": [], "diperbarui": [], "produk": 0}
        for name, s, products in siap:
            info = {k: str(s[k]).strip() for k in ("contact", "phone", "email", "address") if k in s}
            ada = cls.col().find_one({"name": name})
            if ada:
                gabung = {p["sku"]: p for p in ada.get("products", [])}
                for p in products:
                    gabung[p["sku"]] = p
                cls.update(str(ada["_id"]), {**info, "products": list(gabung.values())}, actor)
                hasil["diperbarui"].append(name)
            else:
                cls.create({**info, "name": name, "products": products}, actor)
                hasil["ditambahkan"].append(name)
            hasil["produk"] += len(products)
        return hasil

    @classmethod
    def before_update(cls, current, changes, actor):
        if "name" in changes and changes["name"] != current["name"]:      # nama supplier pada barang ikut diperbarui
            Item.col().update_many({"supplier_id": current["_id"]}, {"$set": {"supplier": changes["name"]}})
        if "products" in changes:
            baru = {p["sku"]: p for p in changes["products"]}
            for p in current.get("products", []):                          # produk yang sudah jadi barang tidak boleh dihapus
                if p["sku"] not in baru and Item.col().count_documents({"supplier_id": current["_id"], "supplier_sku": p["sku"]}):
                    raise AppError(f"Produk {p['name']} sudah terdaftar sebagai barang, tidak bisa dihapus dari supplier", 409)
            for sku, p in baru.items():                                    # harga beli pada barang mengikuti harga supplier
                Item.col().update_many({"supplier_id": current["_id"], "supplier_sku": sku}, {"$set": {"purchase_price": p["price"]}})

    @classmethod
    def before_delete(cls, doc, actor):
        if Item.col().count_documents({"supplier_id": doc["_id"]}):
            raise AppError("Supplier masih memiliki barang terdaftar, tidak bisa dihapus", 409)
        if Database.col("purchase_orders").count_documents({"supplier_id": doc["_id"]}):
            raise AppError("Supplier sudah memiliki PO, tidak bisa dihapus", 409)


class Item(BaseModel):
    """Barang di sistem = produk supplier yang didaftarkan Admin. Nama, satuan, dan harga beli diambil dari supplier."""
    collection, label, sort = "items", "Barang", [("code", 1)]
    fields = {
        "code": {"type": str, "required": True},
        "name": {"type": str, "required": True},
        "category": {"type": str, "required": True},
        "unit": {"type": str, "default": "pcs"},
        "min_stock": {"type": int, "default": 0, "min": 0},
        "warehouse": {"type": str, "default": ""},
        "location": {"type": str, "default": ""},
    }

    @classmethod
    def defaults(cls):
        return {"stock": 0}   # stok hanya berubah lewat transaksi IN / OUT / ADJ

    @classmethod
    def clean(cls, data, partial=False):
        out = super().clean(data, partial)
        if out.get("code"):                      # kode barang: BRG- diikuti angka, contoh BRG-006
            code = out["code"].upper()
            if not re.fullmatch(r"BRG-\d{1,6}", code):
                raise AppError("Kode barang harus berformat BRG-angka, contoh: BRG-006")
            out["code"] = code
        if out.get("location"):                  # lokasi rak: blok huruf + nomor, contoh A-01
            m = re.fullmatch(r"([A-Za-z])-?(\d{1,3})", out["location"])
            if not m:
                raise AppError("Lokasi rak harus berformat Blok-Nomor, contoh: A-01")
            out["location"] = f"{m.group(1).upper()}-{int(m.group(2)):02d}"
        return out

    @classmethod
    def create(cls, data, actor):
        """Daftarkan produk supplier sebagai barang: pilih supplier, lalu produknya dari daftar supplier."""
        if not data.get("supplier_id"):
            raise AppError("Supplier wajib dipilih")
        supplier = Supplier.col().find_one({"_id": oid(data.get("supplier_id"))})
        if not supplier:
            raise AppError("Supplier tidak ditemukan", 404)
        product = Supplier.product(supplier, str(data.get("supplier_sku") or "").strip())
        if not product:
            raise AppError("Produk wajib dipilih dari daftar produk supplier")
        if cls.col().count_documents({"supplier_id": supplier["_id"], "supplier_sku": product["sku"]}):
            raise AppError(f"Produk {product['name']} dari {supplier['name']} sudah terdaftar sebagai barang", 409)
        data = dict(data)
        data["name"] = data.get("name") or product["name"]
        data["unit"] = data.get("unit") or product.get("unit") or "pcs"
        doc = cls.clean(data)
        doc.update(cls.defaults())
        doc.update({"supplier_id": supplier["_id"], "supplier": supplier["name"],
                    "supplier_sku": product["sku"], "purchase_price": product["price"], "created_at": now()})
        try:
            cls.col().insert_one(doc)
        except DuplicateKeyError:
            raise AppError("Barang sudah ada (kode duplikat)", 409)
        AuditLog.log(actor, "create", cls.collection, doc["_id"], f"{doc['code']} dari {supplier['name']}")
        return doc

    @classmethod
    def before_delete(cls, doc, actor):
        if doc.get("stock", 0) > 0 or Database.col("stock_transactions").count_documents({"item_id": doc["_id"]}):
            raise AppError("Barang sudah memiliki stok/transaksi, tidak bisa dihapus", 409)


class User(BaseModel):
    collection, label, sort = "users", "User", [("username", 1)]
    fields = {
        "username": {"type": str, "required": True},
        "full_name": {"type": str, "required": True},
        "role": {"type": str, "required": True},
        "active": {"type": bool, "default": True},
    }

    @classmethod
    def clean(cls, data, partial=False):
        out = super().clean(data, partial)
        if "role" in out and out["role"] not in ROLES:
            raise AppError("Role harus salah satu dari: " + ", ".join(ROLES))
        if "username" in out:
            out["username"] = out["username"].lower().replace(" ", "")
        if out.get("role") == "supplier" and not partial:
            raise AppError("Akun supplier dibuat lewat menu Data Supplier > Buat Akun Portal")
        pwd = data.get("password")
        if pwd:
            if len(str(pwd)) < 6:
                raise AppError("Password minimal 6 karakter")
            out["password_hash"] = generate_password_hash(str(pwd))
        elif not partial:
            raise AppError("Password wajib diisi")
        return out

    @classmethod
    def create_supplier_account(cls, supplier, username, password, actor):
        """Akun portal supplier: terhubung ke satu supplier dan hanya dapat mengelola produk supplier itu."""
        username = str(username or "").strip().lower().replace(" ", "")
        if not username:
            raise AppError("Username wajib diisi")
        if len(str(password or "")) < 6:
            raise AppError("Password minimal 6 karakter")
        if cls.col().find_one({"username": username}):
            raise AppError("Username sudah dipakai", 409)
        doc = {"username": username, "full_name": supplier["name"], "role": "supplier", "active": True,
               "supplier_id": supplier["_id"], "password_hash": generate_password_hash(str(password)), "created_at": now()}
        try:
            cls.col().insert_one(doc)
        except DuplicateKeyError:
            raise AppError("Username sudah dipakai", 409)
        AuditLog.log(actor, "create", "users", doc["_id"], f"akun portal {username} untuk {supplier['name']}")
        return doc

    @classmethod
    def before_update(cls, current, changes, actor):
        if "role" in changes and (changes["role"] == "supplier") != (current["role"] == "supplier"):
            raise AppError("Role supplier hanya lewat Data Supplier > Buat Akun Portal", 409)
        if str(current["_id"]) == str(actor["_id"]) and (changes.get("active") is False or
                                                         changes.get("role", current["role"]) != current["role"]):
            raise AppError("Anda tidak dapat menonaktifkan / mengubah role akun sendiri", 409)

    @classmethod
    def before_delete(cls, doc, actor):
        if str(doc["_id"]) == str(actor["_id"]):
            raise AppError("Anda tidak dapat menghapus akun sendiri", 409)

    @classmethod
    def authenticate(cls, username, password):
        user = cls.col().find_one({"username": str(username or "").strip().lower()})
        if not user or not user.get("active", True) or \
                not check_password_hash(user["password_hash"], str(password or "")):
            raise AppError("Login Gagal: username atau password salah", 401)
        return user


class StockTransaction:
    @staticmethod
    def find(item_id=None, limit=500):
        flt = {"item_id": oid(item_id)} if item_id else {}
        return serialize(list(Database.col("stock_transactions").find(flt).sort("at", -1).limit(limit)))
