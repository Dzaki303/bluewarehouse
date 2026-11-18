"""Logika bisnis sesuai flowchart & sequence diagram:
Request Barang (OUT), Purchase Order (IN), Stock Opname (ADJ), Dashboard."""
from flask import current_app
from pymongo import ReturnDocument
from .core import AppError, InsufficientStock, now, oid, serialize
from .database import Database
from .models import AuditLog, Item, Supplier


def hist(user, text):
    return {"at": now(), "by": user["full_name"], "action": text}


def parse_lines(raw, with_price=False):
    if not isinstance(raw, list) or not raw:
        raise AppError("Minimal satu barang harus dipilih")
    out, seen = [], set()
    for r in raw:
        item = Item.col().find_one({"_id": oid((r or {}).get("item_id"))})
        if not item:
            raise AppError("Barang tidak ditemukan")
        try:
            qty = int(r.get("qty"))
        except (TypeError, ValueError):
            raise AppError("Qty harus berupa angka")
        if qty <= 0:
            raise AppError("Qty harus lebih dari 0")
        if item["_id"] in seen:
            raise AppError(f"Barang {item['code']} terdaftar dua kali, gabungkan qty-nya")
        seen.add(item["_id"])
        line = {"item_id": item["_id"], "code": item["code"], "name": item["name"], "unit": item.get("unit", ""), "qty": qty}
        if with_price:
            try:
                line["price"] = float(r.get("price") or 0)
            except (TypeError, ValueError):
                raise AppError("Harga harus berupa angka")
            if line["price"] < 0:
                raise AppError("Harga tidak boleh negatif")
        out.append(line)
    return out


class StockService:
    @staticmethod
    def move(sess, item_id, delta, ttype, ref_type, ref_id, user, ref_no=""):
        """Update stok ATOMIC + catat kartu stok. Stok tidak boleh negatif."""
        flt = {"_id": item_id}
        if delta < 0:
            flt["stock"] = {"$gte": -delta}
        item = Item.col().find_one_and_update(
            flt, {"$inc": {"stock": delta}}, return_document=ReturnDocument.AFTER, session=sess)
        if not item:
            cur = Item.col().find_one({"_id": item_id}, session=sess)
            if cur:
                raise InsufficientStock(
                    f"Stok tidak cukup untuk {cur['code']} - {cur['name']} (tersedia {cur.get('stock', 0)}, butuh {-delta})")
            raise AppError("Barang tidak ditemukan", 404)
        Database.col("stock_transactions").insert_one({
            "at": now(), "type": ttype, "item_id": item["_id"], "code": item["code"], "name": item["name"],
            "qty": delta, "balance": item["stock"], "ref_type": ref_type, "ref_id": ref_id, "ref_no": ref_no,
            "by": user["full_name"],
        }, session=sess)
        return item


# ------------------------------------------------------------------ Request Barang
class RequestService:
    @staticmethod
    def col():
        return Database.col("requests")

    @classmethod
    def find_all(cls, flt=None):
        return serialize(list(cls.col().find(flt or {}).sort("created_at", -1)))

    @classmethod
    def get(cls, rid):
        doc = cls.col().find_one({"_id": oid(rid)})
        if not doc:
            raise AppError("Request tidak ditemukan", 404)
        return doc

    @classmethod
    def create(cls, user, data):
        doc = {
            "number": Database.next_number("REQ"), "requester_id": user["_id"], "requester": user["full_name"],
            "requester_role": user["role"], "purpose": str(data.get("purpose") or "").strip(),
            "lines": parse_lines(data.get("lines")), "status": "Menunggu", "created_at": now(),
            "history": [hist(user, "Request dibuat (menunggu approval Manager)")],
        }
        cls.col().insert_one(doc)
        AuditLog.log(user, "create", "request", doc["_id"], doc["number"])
        return doc

    @classmethod
    def decide(cls, user, rid, approve, reason=""):
        req = cls.get(rid)
        if req["requester_id"] == user["_id"]:
            raise AppError("Approver tidak boleh sama dengan pembuat request", 403)
        status = "Disetujui" if approve else "Ditolak"
        res = cls.col().update_one(
            {"_id": req["_id"], "status": "Menunggu"},
            {"$set": {"status": status, "approver": user["full_name"], "decided_at": now(), "reject_reason": reason},
             "$push": {"history": hist(user, f"Request {status.lower()}" + (f": {reason}" if reason else ""))}})
        if res.modified_count == 0:
            raise AppError("Request sudah diproses sebelumnya", 409)
        AuditLog.log(user, "approve" if approve else "reject", "request", req["_id"], req["number"])

    @classmethod
    def fulfill(cls, user, rid):
        """Staff input barang keluar -> potong stok & status Selesai dalam SATU transaksi atomic."""
        req = cls.get(rid)
        if req["status"] not in ("Disetujui", "Backorder"):
            raise AppError("Request belum disetujui atau sudah selesai", 409)

        def work(sess):
            for l in req["lines"]:   # 1) potong stok (gagal bila stok kurang)
                StockService.move(sess, l["item_id"], -l["qty"], "OUT", "request", req["_id"], user, req["number"])
            res = cls.col().update_one(   # 2) tandai selesai; semuanya dalam satu transaksi atomic
                {"_id": req["_id"], "status": {"$in": ["Disetujui", "Backorder"]}},
                {"$set": {"status": "Selesai", "fulfilled_by": user["full_name"], "fulfilled_at": now()},
                 "$push": {"history": hist(user, "Barang keluar diinput & diserahkan ke pemohon")}}, session=sess)
            if res.modified_count == 0:
                raise AppError("Request sudah diproses sebelumnya", 409)

        try:
            Database.transaction(work)
        except InsufficientStock as e:
            cls.col().update_one({"_id": req["_id"], "status": "Disetujui"},
                                 {"$set": {"status": "Backorder"}, "$push": {"history": hist(user, e.message + " -> Backorder")}})
            raise
        AuditLog.log(user, "stock_out", "request", req["_id"], req["number"])


# ------------------------------------------------------------------ Purchase Order
CLAIM_TYPES = ("Rusak", "Kelebihan", "Salah Barang", "Lainnya")
CLAIM_STATUSES = ("Terbuka", "Diganti", "Refund", "Ditutup")


class POService:
    """PO dibuat Manager dan langsung berstatus Ordered (tanpa approval).
    Staff memeriksa barang datang; barang tidak sesuai dicatat sebagai klaim ke supplier."""

    @staticmethod
    def col():
        return Database.col("purchase_orders")

    @classmethod
    def find_all(cls, flt=None):
        return serialize(list(cls.col().find(flt or {}).sort("created_at", -1)))

    @classmethod
    def get(cls, pid):
        doc = cls.col().find_one({"_id": oid(pid)})
        if not doc:
            raise AppError("PO tidak ditemukan", 404)
        return doc

    @classmethod
    def create(cls, user, data):
        supplier = Supplier.col().find_one({"_id": oid(data.get("supplier_id"))})
        if not supplier:
            raise AppError("Supplier wajib dipilih")
        lines = parse_lines(data.get("lines"))
        for l in lines:   # PO hanya berisi barang yang sudah didaftarkan dari supplier ini; harga dari supplier
            item = Item.col().find_one({"_id": l["item_id"]})
            if item.get("supplier_id") != supplier["_id"]:
                raise AppError(f"Barang {l['code']} bukan produk {supplier['name']} atau belum didaftarkan dari supplier ini")
            product = Supplier.product(supplier, item.get("supplier_sku"))
            l["price"] = product["price"] if product else item.get("purchase_price", 0)
            l["received"] = 0
        doc = {
            "number": Database.next_number("PO"), "supplier_id": supplier["_id"], "supplier": supplier["name"],
            "creator_id": user["_id"], "creator": user["full_name"], "note": str(data.get("note") or "").strip(),
            "lines": lines, "total": sum(l["qty"] * l["price"] for l in lines),
            "status": "Ordered", "created_at": now(), "claims": [],
            "history": [hist(user, "PO dibuat dan dikirim ke supplier (Ordered)")],
        }
        cls.col().insert_one(doc)
        AuditLog.log(user, "create", "purchase_order", doc["_id"], doc["number"])
        return doc

    @classmethod
    def cancel(cls, user, pid, reason):
        """Batalkan PO yang belum ada barang diterima."""
        reason = str(reason or "").strip()
        if not reason:
            raise AppError("Alasan pembatalan wajib diisi")
        po = cls.get(pid)
        if any(l.get("received", 0) > 0 for l in po["lines"]):
            raise AppError("PO sudah ada barang yang diterima, gunakan Tutup PO (Kurang)", 409)
        res = cls.col().update_one(
            {"_id": po["_id"], "status": "Ordered"},
            {"$set": {"status": "Dibatalkan", "closed_reason": reason, "closed_by": user["full_name"], "closed_at": now()},
             "$push": {"history": hist(user, f"PO dibatalkan: {reason}")}})
        if res.modified_count == 0:
            raise AppError("PO tidak dalam status Ordered", 409)
        AuditLog.log(user, "cancel", "purchase_order", po["_id"], f"{po['number']}: {reason}")

    @classmethod
    def close_short(cls, user, pid, reason):
        """Tutup PO yang sebagian sudah diterima dan sisanya tidak akan dikirim supplier."""
        reason = str(reason or "").strip()
        if not reason:
            raise AppError("Alasan penutupan wajib diisi")
        po = cls.get(pid)
        kurang = ", ".join(f"{l['name']} kurang {l['qty'] - l.get('received', 0)}"
                           for l in po["lines"] if l.get("received", 0) < l["qty"])
        res = cls.col().update_one(
            {"_id": po["_id"], "status": "Partially Received"},
            {"$set": {"status": "Selesai (Kurang)", "closed_reason": reason, "closed_by": user["full_name"], "closed_at": now()},
             "$push": {"history": hist(user, f"PO ditutup dengan kekurangan ({kurang}): {reason}")}})
        if res.modified_count == 0:
            raise AppError("Hanya PO berstatus Partially Received yang dapat ditutup", 409)
        AuditLog.log(user, "close", "purchase_order", po["_id"], f"{po['number']}: {reason}")

    @classmethod
    def update_claim(cls, user, pid, idx, status, note=""):
        po = cls.get(pid)
        claims = po.get("claims", [])
        if not (0 <= idx < len(claims)):
            raise AppError("Klaim tidak ditemukan", 404)
        if status not in CLAIM_STATUSES:
            raise AppError("Status klaim harus salah satu dari: " + ", ".join(CLAIM_STATUSES))
        sets = {f"claims.{idx}.status": status, f"claims.{idx}.updated_by": user["full_name"],
                f"claims.{idx}.updated_at": now()}
        if note:
            sets[f"claims.{idx}.resolution"] = str(note).strip()
        cls.col().update_one({"_id": po["_id"]}, {
            "$set": sets,
            "$push": {"history": hist(user, f"Klaim {claims[idx].get('name', '')} diubah menjadi {status}")}})
        AuditLog.log(user, "claim", "purchase_order", po["_id"], f"{po['number']} klaim #{idx + 1} -> {status}")

    @classmethod
    def receive(cls, user, pid, data):
        """Staff cek barang: Sesuai -> stok bertambah (atomic); Rusak / Kelebihan / Salah Barang / Lainnya -> klaim ke supplier."""
        po = cls.get(pid)
        if po["status"] not in ("Ordered", "Partially Received"):
            raise AppError("PO sudah selesai, dibatalkan, atau diterima semua", 409)
        entries = data.get("lines")
        if not isinstance(entries, list):
            raise AppError("Data penerimaan tidak valid")

        def work(sess):
            doc = cls.col().find_one({"_id": po["_id"]}, session=sess)
            lines, claims, processed = doc["lines"], [], 0
            for e in entries:
                try:
                    qty = int(e.get("qty") or 0)
                except (TypeError, ValueError):
                    raise AppError("Qty terima harus berupa angka")
                if qty <= 0:
                    continue
                line = next((l for l in lines if str(l["item_id"]) == str(e.get("item_id"))), None)
                if not line:
                    raise AppError("Barang tidak ada di PO ini")
                cond = str(e.get("condition") or "Sesuai").strip()
                if cond == "Tidak Sesuai":
                    cond = "Lainnya"
                if cond == "Sesuai":
                    outstanding = line["qty"] - line.get("received", 0)
                    if qty > outstanding:
                        raise AppError(f"Qty sesuai {line['code']} melebihi sisa PO ({outstanding}); "
                                       "catat kelebihan sebagai klaim (kondisi Kelebihan)")
                    StockService.move(sess, line["item_id"], qty, "IN", "po", po["_id"], user, po["number"])
                    line["received"] = line.get("received", 0) + qty
                elif cond in CLAIM_TYPES:
                    claims.append({"item_id": line["item_id"], "code": line["code"], "name": line["name"], "qty": qty,
                                   "type": cond, "status": "Terbuka", "note": str(e.get("note") or "").strip(),
                                   "at": now(), "by": user["full_name"]})
                else:
                    raise AppError("Kondisi harus salah satu dari: Sesuai, " + ", ".join(CLAIM_TYPES))
                processed += 1
            if not processed:
                raise AppError("Tidak ada barang yang diproses (isi qty terima)")
            if all(l.get("received", 0) >= l["qty"] for l in lines):
                status = "Received"
            elif any(l.get("received", 0) > 0 for l in lines):
                status = "Partially Received"
            else:
                status = doc["status"]
            push = {"history": hist(user, f"Pemeriksaan barang: {processed} baris diproses" +
                                    (f", {len(claims)} klaim ke supplier" if claims else ""))}
            if claims:
                push["claims"] = {"$each": claims}
            cls.col().update_one({"_id": po["_id"]}, {"$set": {"lines": lines, "status": status}, "$push": push}, session=sess)

        Database.transaction(work)
        AuditLog.log(user, "receive", "purchase_order", po["_id"], po["number"])


# ------------------------------------------------------------------ Stock Opname
class OpnameService:
    @staticmethod
    def col():
        return Database.col("opnames")

    @classmethod
    def find_all(cls, flt=None):
        return serialize(list(cls.col().find(flt or {}).sort("created_at", -1)))

    @classmethod
    def get(cls, oid_):
        doc = cls.col().find_one({"_id": oid(oid_)})
        if not doc:
            raise AppError("Sesi opname tidak ditemukan", 404)
        return doc

    @classmethod
    def create(cls, user, data):
        wh = str(data.get("warehouse") or "").strip()
        items = list(Item.col().find({"warehouse": wh} if wh else {}).sort("code", 1))
        if not items:
            raise AppError("Tidak ada barang untuk dihitung")
        doc = {
            "number": Database.next_number("OPN"), "warehouse": wh or "Semua warehouse", "note": str(data.get("note") or "").strip(),
            "created_by": user["full_name"], "created_at": now(), "status": "Input Hitung", "round": 1,
            "lines": [{"item_id": i["_id"], "code": i["code"], "name": i["name"], "unit": i.get("unit", ""),
                       "system_qty": i.get("stock", 0), "counted": None, "diff": None} for i in items],
            "history": [hist(user, "Sesi stock opname dibuat")],
        }
        cls.col().insert_one(doc)
        AuditLog.log(user, "create", "opname", doc["_id"], doc["number"])
        return doc

    @classmethod
    def submit_count(cls, user, oid_, data):
        op = cls.get(oid_)
        if op["status"] not in ("Input Hitung", "Hitung Ulang"):
            raise AppError("Sesi opname tidak dalam tahap input hitung", 409)
        counts = {}
        for c in data.get("counts") or []:
            try:
                n = int(c.get("counted"))
            except (TypeError, ValueError):
                raise AppError("Hasil hitung harus berupa angka")
            if n < 0:
                raise AppError("Hasil hitung tidak boleh negatif")
            counts[str(c.get("item_id"))] = n
        thr = current_app.config["OPNAME_THRESHOLD_PCT"]
        for l in op["lines"]:
            if str(l["item_id"]) not in counts:
                raise AppError(f"Barang {l['code']} belum diisi hasil hitungnya")
            cur = Item.col().find_one({"_id": l["item_id"]}) or {}
            l["system_qty"] = cur.get("stock", l["system_qty"])
            l["counted"] = counts[str(l["item_id"])]
            l["diff"] = l["counted"] - l["system_qty"]
        diffs = [l for l in op["lines"] if l["diff"] != 0]
        rnd = op["round"]
        if not diffs:
            status, text = "Selesai", "Tidak ada selisih, opname ditutup"
        elif any(abs(l["diff"]) > max(l["system_qty"], 1) * thr / 100 for l in diffs) and rnd < 2:
            status, rnd, text = "Hitung Ulang", rnd + 1, f"Selisih melebihi ambang {thr:g}% -> hitung ulang"
        else:
            status, text = "Menunggu Approval", f"{len(diffs)} item selisih, adjustment diajukan ke Manager"
        cls.col().update_one({"_id": op["_id"]}, {
            "$set": {"lines": op["lines"], "status": status, "round": rnd, "counted_by": user["full_name"],
                     "counted_by_id": user["_id"], "counted_at": now()},
            "$push": {"history": hist(user, text)}})
        AuditLog.log(user, "count", "opname", op["_id"], f"{op['number']} -> {status}")
        return status

    @classmethod
    def decide(cls, user, oid_, approve, reason=""):
        op = cls.get(oid_)
        if op["status"] != "Menunggu Approval":
            raise AppError("Opname tidak sedang menunggu approval", 409)
        if op.get("counted_by_id") == user["_id"]:
            raise AppError("Approver tidak boleh sama dengan penghitung", 403)
        if not approve:
            cls.col().update_one({"_id": op["_id"], "status": "Menunggu Approval"}, {
                "$set": {"status": "Hitung Ulang", "round": 2},
                "$push": {"history": hist(user, "Adjustment ditolak -> investigasi & hitung ulang" + (f": {reason}" if reason else ""))}})
            AuditLog.log(user, "reject", "opname", op["_id"], op["number"])
            return

        def work(sess):
            res = cls.col().update_one(
                {"_id": op["_id"], "status": "Menunggu Approval"},
                {"$set": {"status": "Selesai", "approver": user["full_name"], "closed_at": now()},
                 "$push": {"history": hist(user, "Adjustment disetujui, stok disesuaikan, opname ditutup")}}, session=sess)
            if res.modified_count == 0:
                raise AppError("Opname sudah diproses sebelumnya", 409)
            for l in op["lines"]:
                if l.get("diff"):
                    StockService.move(sess, l["item_id"], l["diff"], "ADJ", "opname", op["_id"], user, op["number"])

        Database.transaction(work)
        AuditLog.log(user, "approve", "opname", op["_id"], op["number"])


# ------------------------------------------------------------------ Dashboard
class DashboardService:
    @staticmethod
    def stats():
        items = list(Item.col().find())
        low = sorted([i for i in items if i.get("stock", 0) <= i.get("min_stock", 0)], key=lambda i: i.get("stock", 0))
        cnt = lambda col, flt: Database.col(col).count_documents(flt)
        return {
            "stats": {
                "items": len(items),
                "total_stock": sum(i.get("stock", 0) for i in items),
                "low_stock": len(low),
                "pending_requests": cnt("requests", {"status": "Menunggu"}),
                "ready_requests": cnt("requests", {"status": {"$in": ["Disetujui", "Backorder"]}}),
                "pending_opnames": cnt("opnames", {"status": "Menunggu Approval"}),
            },
            "low_items": serialize([{"code": i["code"], "name": i["name"], "stock": i.get("stock", 0),
                                      "min_stock": i.get("min_stock", 0), "unit": i.get("unit", "")} for i in low[:15]]),
        }
