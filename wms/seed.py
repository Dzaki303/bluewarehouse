"""Data awal: 3 akun (admin, manager, staff), master data contoh, dan supplier beserta daftar produk dan harganya.

Supplier adalah pihak luar (hidden entity): datanya berasal dari supplier, bukan diinput Admin lewat aplikasi.
Untuk menambah supplier atau produk, tambahkan di daftar SUPPLIERS di bawah (untuk database baru) atau
langsung di koleksi `suppliers` di MongoDB (field `products`)."""
from pymongo.errors import DuplicateKeyError
from werkzeug.security import generate_password_hash
from .core import now
from .database import Database

USERS = [
    ("admin", "Administrator", "admin", "admin123"),
    ("manager", "Budi Manager", "manager", "manager123"),
    ("staff", "Sari Staff Warehouse", "staff", "staff123"),
]

# produk supplier: (sku, nama, satuan, harga)
SUPPLIERS = [
    {"name": "PT Sumber Makmur", "contact": "Andi", "phone": "081200000001", "email": "sales@sumbermakmur.example",
     "address": "Semarang", "products": [
         ("SM-001", "Laptop 14 inch", "unit", 8500000), ("SM-002", "Mouse Wireless", "pcs", 125000),
         ("SM-003", "Keyboard Mechanical", "pcs", 450000), ("SM-004", "Monitor 24 inch", "unit", 1850000)]},
    {"name": "CV Kertas Jaya", "contact": "Rina", "phone": "081200000002", "email": "order@kertasjaya.example",
     "address": "Solo", "products": [
         ("KJ-001", "Kertas A4 80gr", "rim", 52000), ("KJ-002", "Pulpen Hitam", "box", 38000),
         ("KJ-003", "Spidol Whiteboard", "box", 55000), ("KJ-004", "Map Folder", "pack", 24000)]},
    {"name": "PT Safety Prima", "contact": "Joko", "phone": "081200000003", "email": "cs@safetyprima.example",
     "address": "Surabaya", "products": [
         ("SP-001", "Helm Safety", "pcs", 45000), ("SP-002", "Sarung Tangan Safety", "pasang", 18000),
         ("SP-003", "Sepatu Safety", "pasang", 275000)]},
]

# barang contoh yang sudah didaftarkan: (kode, sku produk supplier, kategori, stok min, rak, stok)
ITEMS = [
    ("BRG-001", "SM-001", "Elektronik", 5, "A-01", 12),
    ("BRG-002", "SM-002", "Elektronik", 10, "A-02", 8),
    ("BRG-003", "KJ-001", "Alat Tulis", 20, "B-01", 60),
    ("BRG-004", "KJ-002", "Alat Tulis", 10, "B-02", 25),
    ("BRG-005", "SP-001", "Perlengkapan", 15, "C-01", 4),
]


def _products(rows):
    return [{"sku": sku, "name": name, "unit": unit, "price": price} for sku, name, unit, price in rows]


class Seeder:
    @staticmethod
    def _insert(col, doc):
        try:
            Database.col(col).insert_one({**doc, "created_at": now()})
        except DuplicateKeyError:
            pass

    @classmethod
    def run(cls):
        if Database.col("users").count_documents({}) == 0:
            for u, name, role, pwd in USERS:
                cls._insert("users", {"username": u, "full_name": name, "role": role,
                                      "active": True, "password_hash": generate_password_hash(pwd)})
        if Database.col("items").count_documents({}) == 0:
            for c in ("Elektronik", "Alat Tulis", "Perlengkapan"):
                cls._insert("categories", {"name": c, "description": ""})
            cls._insert("warehouses", {"name": "Gudang Utama", "address": "Jl. Industri No. 1"})
            for s in SUPPLIERS:
                cls._insert("suppliers", {**{k: v for k, v in s.items() if k != "products"}, "products": _products(s["products"])})
            by_sku = {}
            for sup in Database.col("suppliers").find():
                for p in sup.get("products", []):
                    by_sku[p["sku"]] = (sup, p)
            for code, sku, cat, mn, loc, stock in ITEMS:
                sup, p = by_sku[sku]
                cls._insert("items", {"code": code, "name": p["name"], "category": cat, "unit": p["unit"], "min_stock": mn,
                                      "warehouse": "Gudang Utama", "location": loc, "stock": stock,
                                      "supplier_id": sup["_id"], "supplier": sup["name"], "supplier_sku": sku,
                                      "purchase_price": p["price"]})
            cls._demo_supplier_account()      # hanya saat database baru diisi
        cls._migrate_catalog()

    @staticmethod
    def _migrate_catalog():
        """Database versi lama: katalog supplier (`catalog`) diubah menjadi daftar produk supplier (`products`),
        dan barang yang ada di katalog dihubungkan ke supplier-nya."""
        seed = {s["name"]: _products(s["products"]) for s in SUPPLIERS}
        for sup in Database.col("suppliers").find({"catalog": {"$exists": True}}):
            products = list(sup.get("products", []))
            for c in sup["catalog"]:
                match = next((p for p in seed.get(sup["name"], []) if p["name"] == c["name"]), None)
                sku = match["sku"] if match else c["code"]
                if not any(p["sku"] == sku for p in products):
                    products.append({"sku": sku, "name": c["name"], "unit": c.get("unit", ""), "price": c["price"]})
                Database.col("items").update_one(
                    {"_id": c["item_id"], "supplier_id": {"$exists": False}},
                    {"$set": {"supplier_id": sup["_id"], "supplier": sup["name"], "supplier_sku": sku, "purchase_price": c["price"]}})
            for p in seed.get(sup["name"], []):          # lengkapi dengan produk lain dari supplier
                if not any(x["sku"] == p["sku"] for x in products):
                    products.append(p)
            Database.col("suppliers").update_one({"_id": sup["_id"]}, {"$set": {"products": products}, "$unset": {"catalog": ""}})

    @staticmethod
    def _demo_supplier_account():
        """Akun portal contoh (supplier / supplier123) untuk PT Sumber Makmur, dibuat hanya saat data awal diisi."""
        if Database.col("users").count_documents({"role": "supplier"}):
            return
        sup = Database.col("suppliers").find_one({"name": "PT Sumber Makmur"})
        if sup:
            Seeder._insert("users", {"username": "supplier", "full_name": sup["name"], "role": "supplier", "active": True,
                                     "supplier_id": sup["_id"], "password_hash": generate_password_hash("supplier123")})
