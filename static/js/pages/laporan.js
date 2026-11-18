/* Monitoring: Laporan */

function halamanLaporan() {
    const jenis = () => $$("jenis_laporan").getValue();
    const tampilkan = () => panggilApi("GET", `/api/reports/${jenis()}/json`).then(res => {
        const kolom = res.headers.map((h, i) => ({ id: "c" + i, header: h, fillspace: true, minWidth: 90 }));
        const data = res.rows.map((baris, idx) => { const o = { id: idx + 1 }; baris.forEach((v, i) => { o["c" + i] = v; }); return o; });
        $$("grid_laporan").refreshColumns(kolom);
        isiGrid("grid_laporan", data);
    });
    const unduh = format => window.open(`/api/reports/${jenis()}/${format}`, "_blank");
    return {
        muat: tampilkan,
        ui: {
            id: "reports", rows: [judul("Monitoring dan Laporan"), {
                view: "toolbar", elements: [
                    {
                        view: "richselect", id: "jenis_laporan", width: 300, value: "inventory", options: [
                            { id: "inventory", value: "Stok dan Saldo Inventory" }, { id: "low_stock", value: "Barang di Bawah Stok Minimum" },
                            { id: "stock_card", value: "Kartu Stok (IN / OUT / ADJ)" }, { id: "requests", value: "Rekap Request Barang" }, { id: "purchase_orders", value: "Rekap Purchase Order" }, { id: "claims", value: "Rekap Klaim ke Supplier" }
                        ],
                        on: { onChange: tampilkan }
                    },
                    tombol("Tampilkan", tampilkan), tombol("Unduh Excel (.xlsx)", () => unduh("xlsx"), "webix_primary"), tombol("Unduh PDF", () => unduh("pdf"), "webix_primary"), {}
                ]
            }, buatGrid("grid_laporan", [{ id: "c0", header: "" }])]
        }
    };
}
