/* Halaman: Dashboard */

function halamanDashboard() {
    function kartu(d) {
        const s = d.stats || {};
        const k = (v, l, css) => `<div class="card ${css || ""}"><div class="v">${v == null ? "-" : v}</div><div class="l">${l}</div></div>`;
        return `<div class="cards">${k(s.items, "Jenis barang")}${k(s.total_stock, "Total unit stok", "ok")}${k(s.low_stock, "Barang stok menipis", "bad")}
            ${k(s.pending_requests, "Request menunggu approval", "warn")}${k(s.ready_requests, "Request siap diserahkan / backorder", "warn")}
            ${k(s.pending_opnames, "Adjustment opname menunggu approval", "warn")}</div>`;
    }
    const muat = () => panggilApi("GET", "/api/dashboard").then(d => {
        $$("kartu_dashboard").setValues(d);
        isiGrid("grid_stok_menipis", d.low_items);
    });
    return {
        muat: muat,
        ui: {
            id: "dashboard", rows: [
                judul("Dashboard - " + LABEL_ROLE[userAktif.role]),
                { view: "template", id: "kartu_dashboard", height: 210, borderless: true, scroll: false, template: kartu, data: {} },
                {
                    rows: [{ template: "Barang di bawah stok minimum", type: "header" }, buatGrid("grid_stok_menipis", [
                        { id: "code", header: "Kode", width: 90 }, { id: "name", header: "Barang", fillspace: true },
                        { id: "stock", header: "Stok", width: 70, css: "low" }, { id: "min_stock", header: "Min", width: 60 }, { id: "unit", header: "Satuan", width: 70 }
                    ])]
                }
            ]
        }
    };
}
