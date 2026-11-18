/* Core: state global & konstanta */

/* ===================================================================
   WMS Warehouse - Frontend Webix
   Semua data diambil dari REST API Flask (JSON) memakai webix.ajax
   =================================================================== */
let userAktif = null;      // user yang sedang login
const HALAMAN = {};        // id halaman -> { muat() }

window.addEventListener("unhandledrejection", e => e.preventDefault());

const LABEL_ROLE = { admin: "Admin", manager: "Manager", staff: "Staff Warehouse", supplier: "Supplier" };
const WARNA_STATUS = {
    "Menunggu": "warn", "Menunggu Approval": "warn", "Hitung Ulang": "warn",
    "Disetujui": "info", "Ordered": "info", "Partially Received": "info", "Input Hitung": "info",
    "Backorder": "bad", "Ditolak": "bad", "Dibatalkan": "bad", "Selesai": "ok", "Received": "ok", "Selesai (Kurang)": "warn",
    "Terbuka": "warn", "Diganti": "ok", "Refund": "ok", "Ditutup": "info"
};
