/* Transaksi: Stock Opname */

function detailOpname(p) {
    return `<div class="dtl"><div class="meta"><b>${esc(p.number)}</b> ${badge(p.status)}<br>Warehouse: ${esc(p.warehouse)}<br>Dibuat oleh: ${esc(p.created_by)} - ${fmtTanggal(p.created_at)}<br>
        Penghitung: ${esc(p.counted_by || "-")} (putaran hitung ke-${p.round})<br>Approver: ${esc(p.approver || "-")}</div>
        <h4>Hasil Hitung</h4>${buatTabel(["Kode", "Barang", "Sistem", "Fisik", "Selisih"], p.lines.map(l => [l.code, l.name, l.system_qty, l.counted == null ? "-" : l.counted, l.diff == null ? "-" : l.diff]))}
        <h4>Riwayat</h4>${buatTabel(["Waktu", "Oleh", "Aksi"], p.history.map(h => [fmtTanggal(h.at), h.by, h.action]))}</div>`;
}

function jendelaHitung(op) {
    const T = "grid_hitung";
    const baris = op.lines.map(l => ({
        id: l.item_id, item_id: l.item_id, code: l.code, name: l.name, system_qty: l.system_qty,
        counted: l.counted == null ? "" : l.counted, diff: l.diff == null ? "" : l.diff
    }));
    bukaJendela({
        view: "window", id: "win_hitung", head: `Input Hasil Hitung Fisik - ${op.number} (putaran ${op.round})`, modal: true, position: "center", width: 820, close: true,
        body: {
            rows: [
                { template: "Klik kolom <b>Hitung Fisik</b> untuk mengisi hasil hitung. Semua barang wajib diisi. Selisih dihitung otomatis oleh sistem.", height: 44, borderless: true },
                {
                    view: "datatable", id: T, height: 340, editable: true, editaction: "click", data: baris,
                    columns: [
                        { id: "code", header: "Kode", width: 100 }, { id: "name", header: "Barang", fillspace: true },
                        { id: "system_qty", header: "Stok Sistem", width: 100 }, { id: "counted", header: "Hitung Fisik", width: 110, editor: "text", css: { background: "#fffbe6" } },
                        { id: "diff", header: "Selisih", width: 90, template: o => o.diff === "" ? "" : (o.diff != 0 ? `<span class="low">${o.diff}</span>` : "0") }
                    ],
                    on: { onAfterEditStop(state, ed) { const r = this.getItem(ed.row); r.diff = r.counted === "" ? "" : (+r.counted - r.system_qty); this.refresh(ed.row); } }
                },
                {
                    cols: [{}, {
                        view: "button", value: "Kirim Hasil Hitung", width: 180, css: "webix_primary", click: () => {
                            $$(T).editStop();
                            const counts = $$(T).serialize().map(r => ({ item_id: r.item_id, counted: r.counted }));
                            panggilApi("POST", `/api/opnames/${op.id}/count`, { counts: counts }).then(res => {
                                $$("win_hitung").close();
                                webix.message({ text: "Hasil hitung dikirim. Status: " + res.status, expire: 5000 });
                                HALAMAN.opnames.muat();
                            });
                        }
                    }, { view: "button", value: "Batal", width: 100, click: () => $$("win_hitung").close() }]
                }
            ]
        }
    });
}

function halamanOpname() {
    const G = "grid_opnames";
    const muat = () => panggilApi("GET", "/api/opnames").then(res => isiGrid(G, res.data));
    function aksi(nama, teks, tanyaAlasan) {
        const r = pilihBaris(G); if (!r) return;
        const jalankan = alasan => panggilApi("POST", `/api/opnames/${r.id}/${nama}`, { reason: alasan }).then(() => {
            webix.message({ type: "success", text: "Berhasil" }); muat();
        });
        if (tanyaAlasan) mintaAlasan(`${teks} ${r.number}`, jalankan); else konfirmasi(`${teks} ${esc(r.number)}? Stok akan disesuaikan.`, () => jalankan(""));
    }
    function buatSesi() {
        panggilApi("GET", "/api/warehouses").then(res => bukaJendela({
            view: "window", id: "win_sesi", head: "Buat Sesi Stock Opname", modal: true, position: "center", width: 420, close: true,
            body: {
                view: "form", id: "form_sesi", elementsConfig: { labelWidth: 100 }, elements: [
                    { view: "richselect", name: "warehouse", label: "Warehouse", value: "", options: [{ id: "", value: "Semua warehouse" }, ...res.data.map(x => ({ id: x.name, value: x.name }))] },
                    { view: "text", name: "note", label: "Catatan" },
                    {
                        cols: [
                            { view: "button", value: "Buat Sesi", css: "webix_primary", click: () => panggilApi("POST", "/api/opnames", $$("form_sesi").getValues()).then(() => { $$("win_sesi").close(); webix.message({ type: "success", text: "Sesi opname dibuat" }); muat(); }) },
                            { view: "button", value: "Batal", click: () => $$("win_sesi").close() }
                        ]
                    }
                ]
            }
        }));
    }
    const bar = [kotakCari(G), tombol("Refresh", muat), tombol("Detail", () => { const r = pilihBaris(G); if (r) tampilDetail(r.number, detailOpname(r)); })];
    if (userAktif.role === "manager") bar.push(tombol("Buat Sesi Opname", buatSesi, "webix_primary"));
    if (userAktif.role === "staff") bar.push(tombol("Input Hasil Hitung", () => {
        const r = pilihBaris(G); if (!r) return;
        if (!["Input Hitung", "Hitung Ulang"].includes(r.status)) { webix.message({ type: "error", text: "Sesi ini tidak dalam tahap input hitung" }); return; }
        jendelaHitung(r);
    }, "webix_primary"));
    if (userAktif.role === "manager") bar.push(tombol("Setujui Adjustment", () => aksi("approve", "Setujui adjustment", false)), tombol("Tolak (hitung ulang)", () => aksi("reject", "Tolak adjustment", true)));
    bar.push({});
    return {
        muat: muat,
        ui: {
            id: "opnames", rows: [judul("Stock Opname"), { view: "toolbar", elements: bar }, buatGrid(G, [
                { id: "number", header: "No. Opname", width: 120, sort: "string" }, { id: "warehouse", header: "Warehouse", width: 160 },
                { id: "status", header: "Status", width: 160, sort: "string", template: o => badge(o.status) },
                { id: "round", header: "Putaran", width: 80 },
                { id: "diffs", header: "Item Selisih", width: 100, template: o => o.lines.filter(l => l.diff).length },
                { id: "counted_by", header: "Penghitung", width: 150 }, { id: "created_by", header: "Dibuat oleh", width: 150 },
                { id: "created_at", header: "Tanggal", width: 150, format: fmtTanggal }, { id: "note", header: "Catatan", fillspace: true }
            ], dblKlik(r => tampilDetail(r.number, detailOpname(r))))]
        }
    };
}
