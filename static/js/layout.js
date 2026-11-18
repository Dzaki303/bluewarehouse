/* Alur 2: kerangka aplikasi & menu per role */

function daftarMenu() {
    const AM = ["admin", "manager"], AS = ["admin", "staff"], MS = ["manager", "staff"];
    return [
        { id: "dashboard", value: "Dashboard", roles: ["admin"], bangun: halamanDashboard },
        { id: "items", value: "Barang dan Stok", roles: AS, bangun: halamanBarang },
        { id: "stockcard", value: "Kartu Stok", roles: AS, bangun: halamanKartuStok },
        { id: "categories", value: "Kategori", roles: ["admin"], bangun: halamanKategori },
        { id: "warehouses", value: "Warehouse", roles: ["admin"], bangun: halamanWarehouse },
        { id: "suppliers", value: "Data Supplier", roles: ["admin"], bangun: halamanSupplier },
        { id: "requests", value: "Request Barang", roles: MS, bangun: halamanRequest },
        { id: "pos", value: "Purchase Order dan Barang Masuk", roles: MS, bangun: halamanPO },
        { id: "opnames", value: "Stock Opname", roles: MS, bangun: halamanOpname },
        { id: "reports", value: "Monitoring dan Laporan", roles: AM, bangun: halamanLaporan },
        { id: "audit", value: "Audit Log", roles: AM, bangun: halamanAudit },
        { id: "users", value: "Pengguna", roles: ["admin"], bangun: halamanPengguna }
    ];
}

function mulaiAplikasi(user) {
    if (user.role === "supplier") { window.location.href = "/portal"; return; }   // akun supplier memakai portal sendiri
    userAktif = user;
    hancurkanRoot();
    const menu = daftarMenu().filter(m => !m.roles || m.roles.includes(user.role));
    webix.ui({
        id: "root",
        rows: [
            {
                view: "toolbar", elements: [
                    { view: "label", label: "WMS Warehouse", width: 220 },
                    {},
                    { view: "label", align: "right", width: 380, label: `${esc(user.full_name)} (${LABEL_ROLE[user.role]})` },
                    { view: "button", value: "Logout", width: 90, click: prosesLogout }
                ]
            },
            {
                cols: [
                    {
                        view: "list", id: "menu", width: 220, select: true, scroll: "auto", type: { height: 42 },
                        template: "#value#", data: menu.map(m => ({ id: m.id, value: m.value })),
                        on: { onAfterSelect(id) { $$("halaman").setValue(id); HALAMAN[id].muat(); } }
                    },
                    { view: "multiview", id: "halaman", animate: false, cells: menu.map(m => { const h = m.bangun(); HALAMAN[m.id] = h; return h.ui; }) }
                ]
            }
        ]
    });
    $$("menu").select(menu[0].id);   // halaman pertama sesuai role
}
