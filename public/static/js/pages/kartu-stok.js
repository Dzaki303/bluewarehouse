/* Monitoring: Kartu Stok */

function halamanKartuStok() {
    const G = "grid_kartu";
    const muatTransaksi = () => {
        const id = $$("filter_kartu").getValue();
        panggilApi("GET", "/api/transactions" + (id ? "?item_id=" + id : "")).then(res => isiGrid(G, res.data));
    };
    const muat = () => panggilApi("GET", "/api/items").then(res => {
        const list = $$("filter_kartu").getList();
        list.clearAll();
        list.parse([{ id: "", value: "Semua barang" }, ...res.data.map(i => ({ id: i.id, value: `${i.code} - ${i.name}` }))]);
        muatTransaksi();
    });
    return {
        muat: muat,
        ui: {
            id: "stockcard", rows: [judul("Kartu Stok"), { template: "Kartu Stok adalah buku catatan pergerakan stok tiap barang: <b>IN</b> = masuk (penerimaan barang PO), <b>OUT</b> = keluar (Request Barang), <b>ADJ</b> = penyesuaian hasil Stock Opname. Kolom <b>Saldo</b> adalah stok setelah transaksi itu. Pilih barang di filter untuk melihat riwayat satu barang.", height: 62, borderless: true }, {
                view: "toolbar", elements: [
                    { view: "combo", id: "filter_kartu", width: 360, placeholder: "Filter barang...", options: [], on: { onChange: muatTransaksi } },
                    tombol("Refresh", muat), {}
                ]
            }, buatGrid(G, [
                { id: "at", header: "Tanggal", width: 150, format: fmtTanggal }, { id: "code", header: "Kode", width: 100 }, { id: "name", header: "Barang", fillspace: true },
                { id: "type", header: "Tipe", width: 70, template: o => `<span class="badge ${o.type === "IN" ? "ok" : o.type === "OUT" ? "bad" : "warn"}">${o.type}</span>` },
                { id: "qty", header: "Qty", width: 80 }, { id: "balance", header: "Saldo", width: 80 },
                { id: "ref_no", header: "Referensi", width: 120 }, { id: "by", header: "Oleh", width: 160 }
            ])]
        }
    };
}
