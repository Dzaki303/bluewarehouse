"""Menambah atau memperbarui supplier beserta daftar produk dan harganya dari file JSON.

Pemakaian (dari folder proyek, virtualenv aktif):
    python tambah_supplier.py supplier_baru.json

- Supplier baru (nama belum ada) akan ditambahkan.
- Supplier yang namanya sudah ada diperbarui: produk dengan sku yang sama diperbarui harganya,
  produk dengan sku baru ditambahkan. Produk yang tidak ada di file tidak dihapus.
- Tidak perlu restart aplikasi; Admin cukup membuka ulang form Tambah Barang dari Supplier.
"""
import json
import sys

from config import Config
from wms.core import now
from wms.database import Database

FIELD_SUPPLIER = ("contact", "phone", "email", "address")


def bersihkan_produk(daftar, nama_supplier):
    hasil, sudah = [], set()
    for i, p in enumerate(daftar or [], start=1):
        sku = str(p.get("sku", "")).strip()
        nama = str(p.get("name", "")).strip()
        if not sku or not nama:
            sys.exit(f"[{nama_supplier}] produk ke-{i}: 'sku' dan 'name' wajib diisi")
        if sku in sudah:
            sys.exit(f"[{nama_supplier}] sku {sku} muncul dua kali di file")
        try:
            harga = float(p.get("price"))
        except (TypeError, ValueError):
            sys.exit(f"[{nama_supplier}] produk {sku}: 'price' harus berupa angka")
        if harga < 0:
            sys.exit(f"[{nama_supplier}] produk {sku}: 'price' tidak boleh negatif")
        sudah.add(sku)
        hasil.append({"sku": sku, "name": nama, "unit": str(p.get("unit", "pcs")).strip() or "pcs", "price": harga})
    return hasil


def main(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        data = [data]
    Database.connect(Config.MONGO_URI, Config.MONGO_DB)
    col = Database.col("suppliers")
    for s in data:
        nama = str(s.get("name", "")).strip()
        if not nama:
            sys.exit("Setiap supplier wajib punya 'name'")
        baru = bersihkan_produk(s.get("products"), nama)
        ada = col.find_one({"name": nama})
        if ada:
            gabung = {p["sku"]: p for p in ada.get("products", [])}
            for p in baru:
                gabung[p["sku"]] = p
            sets = {k: str(s[k]).strip() for k in FIELD_SUPPLIER if k in s}
            sets["products"] = list(gabung.values())
            col.update_one({"_id": ada["_id"]}, {"$set": sets})
            print(f"Diperbarui : {nama} ({len(baru)} produk di file, total {len(gabung)})")
        else:
            doc = {"name": nama, "products": baru, "created_at": now()}
            doc.update({k: str(s.get(k, "")).strip() for k in FIELD_SUPPLIER})
            col.insert_one(doc)
            print(f"Ditambahkan: {nama} ({len(baru)} produk)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Pemakaian: python tambah_supplier.py supplier_baru.json")
    main(sys.argv[1])
