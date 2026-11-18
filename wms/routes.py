"""REST API (JSON) yang dikonsumsi frontend Webix.
CRUD master data memakai class-based views (MethodView); workflow memakai endpoint aksi."""
from flask import Blueprint, jsonify, request, send_file
from flask.views import MethodView
from .auth import SessionManager, require, public_user
from .core import AppError, serialize
from .models import (AuditLog, Category, Item, StockTransaction, Supplier, User, Warehouse)
from .reports import EXPORTERS, ReportBuilder
from .services import DashboardService, OpnameService, POService, RequestService

auth_bp = Blueprint("auth", __name__)
api = Blueprint("api", __name__)

ALL_VIEW = ("manager", "staff")   # role yang boleh melihat semua request


def body():
    return request.get_json(silent=True) or {}


# ------------------------------------------------------------------ Auth
@auth_bp.post("/login")
def login():
    from flask import g
    data = body()
    user = User.authenticate(data.get("username"), data.get("password"))
    SessionManager.start(user)
    g.user = user
    return jsonify({"user": public_user(user)})


@auth_bp.post("/logout")
def logout():
    SessionManager.end()
    return jsonify({"ok": True})


@auth_bp.get("/me")
def me():
    from flask import g
    return jsonify({"user": public_user(g.user) if g.get("user") else None})


# ------------------------------------------------------------------ CRUD generik
class ResourceAPI(MethodView):
    model = None
    read_roles = ()                          # kosong = semua user yang login
    write_roles = ("admin",)                 # data master hanya dikelola Admin

    def get(self, rid=None):
        require(*self.read_roles)
        if rid:
            return jsonify(serialize(self.model.get(rid)))
        return jsonify({"data": self.model.find_all()})

    def post(self):
        user = require(*self.write_roles)
        return jsonify(serialize(self.model.create(body(), user))), 201

    def put(self, rid):
        user = require(*self.write_roles)
        return jsonify(serialize(self.model.update(rid, body(), user)))

    def delete(self, rid):
        user = require(*self.write_roles)
        self.model.delete(rid, user)
        return jsonify({"ok": True})


class ItemAPI(ResourceAPI):
    model = Item


class CategoryAPI(ResourceAPI):
    model = Category


class WarehouseAPI(ResourceAPI):
    model = Warehouse


class SupplierAPI(ResourceAPI):
    model = Supplier
    read_roles = ("admin", "manager")        # Manager membaca supplier dan produknya untuk membuat PO
    write_roles = ("admin",)


class UserAPI(ResourceAPI):
    model = User
    read_roles = ("admin",)
    write_roles = ("admin",)


def register(name, view):
    fn = view.as_view(name)
    api.add_url_rule(f"/{name}", view_func=fn, methods=["GET", "POST"])
    api.add_url_rule(f"/{name}/<rid>", view_func=fn, methods=["GET", "PUT", "DELETE"])


for _name, _view in (("items", ItemAPI), ("categories", CategoryAPI), ("warehouses", WarehouseAPI),
                     ("suppliers", SupplierAPI), ("users", UserAPI)):
    register(_name, _view)


@api.post("/suppliers/import")
def import_suppliers():
    """Admin: import supplier + produk + harga dari JSON (satu objek atau daftar)."""
    user = require("admin")
    raw = request.get_json(silent=True)
    if raw is None:
        raise AppError("JSON tidak valid")
    return jsonify(Supplier.import_json(raw, user)), 201


@api.post("/suppliers/<rid>/account")
def create_supplier_account(rid):
    """Admin membuatkan akun portal untuk supplier."""
    user = require("admin")
    data = body()
    User.create_supplier_account(Supplier.get(rid), data.get("username"), data.get("password"), user)
    return jsonify({"ok": True}), 201


# ------------------------------------------------------------------ Portal Supplier (akun role supplier)
PORTAL_FIELDS = ("contact", "phone", "email", "address", "products")   # nama supplier hanya diubah Admin


@api.get("/portal/supplier")
def portal_get():
    user = require("supplier")
    supplier = Supplier.get(user.get("supplier_id"))
    registered = [i["supplier_sku"] for i in Item.col().find({"supplier_id": supplier["_id"]}, {"supplier_sku": 1})]
    return jsonify({"supplier": serialize(supplier), "registered": registered})


@api.put("/portal/supplier")
def portal_update():
    user = require("supplier")
    data = {k: v for k, v in body().items() if k in PORTAL_FIELDS}
    updated = Supplier.update(str(user["supplier_id"]), data, user)
    return jsonify({"supplier": serialize(updated)})


# ------------------------------------------------------------------ Request Barang
@api.get("/requests")
def list_requests():
    user = require("manager", "staff")
    flt = {} if user["role"] in ALL_VIEW else {"requester_id": user["_id"]}
    return jsonify({"data": RequestService.find_all(flt)})


@api.post("/requests")
def create_request():
    user = require("staff")                            # Staff membuat request, Manager menyetujui
    return jsonify(serialize(RequestService.create(user, body()))), 201


@api.post("/requests/<rid>/<action>")
def request_action(rid, action):
    if action in ("approve", "reject"):
        user = require("manager")
        RequestService.decide(user, rid, action == "approve", str(body().get("reason") or ""))
    elif action == "fulfill":
        user = require("staff")
        RequestService.fulfill(user, rid)
    else:
        raise AppError("Aksi tidak dikenal", 404)
    return jsonify({"ok": True})


# ------------------------------------------------------------------ Purchase Order
@api.get("/purchase-orders")
def list_pos():
    require("manager", "staff")
    return jsonify({"data": POService.find_all()})


@api.post("/purchase-orders")
def create_po():
    user = require("manager")                          # PO langsung berstatus Ordered (tanpa approval)
    return jsonify(serialize(POService.create(user, body()))), 201


@api.post("/purchase-orders/<pid>/<action>")
def po_action(pid, action):
    if action == "cancel":
        user = require("manager")
        POService.cancel(user, pid, body().get("reason"))
    elif action == "close":
        user = require("manager")
        POService.close_short(user, pid, body().get("reason"))
    elif action == "receive":
        user = require("staff")
        POService.receive(user, pid, body())
    else:
        raise AppError("Aksi tidak dikenal", 404)
    return jsonify({"ok": True})


@api.post("/purchase-orders/<pid>/claims/<int:idx>")
def po_claim(pid, idx):
    user = require("manager")
    data = body()
    POService.update_claim(user, pid, idx, str(data.get("status") or ""), data.get("note"))
    return jsonify({"ok": True})


# ------------------------------------------------------------------ Stock Opname
@api.get("/opnames")
def list_opnames():
    require("manager", "staff")
    return jsonify({"data": OpnameService.find_all()})


@api.post("/opnames")
def create_opname():
    user = require("manager")
    return jsonify(serialize(OpnameService.create(user, body()))), 201


@api.post("/opnames/<oid_>/<action>")
def opname_action(oid_, action):
    if action == "count":
        user = require("staff")
        status = OpnameService.submit_count(user, oid_, body())
        return jsonify({"ok": True, "status": status})
    if action in ("approve", "reject"):
        user = require("manager")
        OpnameService.decide(user, oid_, action == "approve", str(body().get("reason") or ""))
        return jsonify({"ok": True})
    raise AppError("Aksi tidak dikenal", 404)


# ------------------------------------------------------------------ Kartu stok, dashboard, laporan, audit
@api.get("/transactions")
def transactions():
    require()
    return jsonify({"data": StockTransaction.find(request.args.get("item_id"))})


@api.get("/dashboard")
def dashboard():
    require("admin")
    return jsonify(DashboardService.stats())


@api.get("/audit-logs")
def audit_logs():
    require("admin", "manager")
    return jsonify({"data": AuditLog.find()})


@api.get("/reports/<kind>/<fmt>")
def report(kind, fmt):
    require("admin", "manager")
    rep = ReportBuilder.build(kind)
    if fmt == "json":
        return jsonify(rep)
    exporter = EXPORTERS.get(fmt)
    if not exporter:
        raise AppError("Format harus xlsx / pdf / json", 404)
    return send_file(exporter.export(rep), mimetype=exporter.mimetype, as_attachment=True,
                     download_name=f"laporan-{kind}.{exporter.ext}")
