/* Transaksi: Purchase Order, Penerimaan & Klaim */

function detailPO(p) {
    const klaim = p.claims && p.claims.length
        ? `<h4>Klaim ke Supplier</h4>${buatTabel(["Waktu", "Barang", "Qty", "Jenis", "Status", "Catatan", "Oleh"],
            p.claims.map(c => [fmtTanggal(c.at), c.name, c.qty, c.type || "Lainnya", c.status || "Terbuka", c.note, c.by]))}` : "";
    return `<div class="dtl"><div class="meta"><b>${esc(p.number)}</b> ${badge(p.status)}<br>Supplier: ${esc(p.supplier)}<br>Dibuat oleh: ${esc(p.creator)} - ${fmtTanggal(p.created_at)}<br>
        Catatan: ${esc(p.note || "-")}<br>Total: Rp ${rupiah(p.total)}
        ${p.closed_reason ? `<br>Alasan pembatalan / penutupan: ${esc(p.closed_reason)} (${esc(p.closed_by || "-")})` : ""}</div>
        <h4>Barang</h4>${buatTabel(["Kode", "Barang", "Dipesan", "Diterima", "Harga"], p.lines.map(l => [l.code, l.name, l.qty, l.received || 0, rupiah(l.price)]))}
        ${klaim}
        <h4>Riwayat</h4>${buatTabel(["Waktu", "Oleh", "Aksi"], p.history.map(h => [fmtTanggal(h.at), h.by, h.action]))}</div>`;
}

// PO dibuat Manager dan langsung berstatus Ordered.
// Alur: pilih supplier dulu, lalu pilih barang yang sudah didaftarkan dari supplier itu (harga dari supplier).
// Setelah ada barang di PO, supplier terkunci; untuk ganti supplier hapus dulu semua barang.
function bukaFormPO() {
    Promise.all([panggilApi("GET", "/api/suppliers"), panggilApi("GET", "/api/items")]).then(([sp, it]) => {
        const supplier = {};
        sp.data.forEach(s => { supplier[s.id] = s; });
        let ctl = null;
        ctl = jendelaBaris({
            id: "win_po", judul: "Purchase Order Baru", items: [], harga: true, labelKirim: "Buat PO",
            placeholder: "Pilih supplier terlebih dahulu...", pesanKosong: "Pilih supplier, lalu pilih barangnya",
            petunjuk: "Langkah: <b>1)</b> pilih supplier, <b>2)</b> pilih barang yang sudah terdaftar dari supplier tersebut. Harga dari supplier; subtotal berubah sesuai qty. Setelah ada barang, supplier terkunci (hapus semua barang untuk menggantinya).",
            fields: [
                {
                    view: "richselect", id: "po_supplier", name: "supplier_id", label: "Supplier", required: true,
                    options: sp.data.map(s => ({ id: s.id, value: s.name })),
                    on: {
                        onChange(v) {
                            const produk = ((supplier[v] || {}).products) || [];
                            const barang = it.data.filter(i => i.supplier_id === v);
                            ctl.setItems(barang.map(i => {
                                const p = produk.find(x => x.sku === i.supplier_sku);
                                const harga = p ? p.price : (i.purchase_price || 0);
                                return { id: i.id, code: i.code, name: i.name, unit: i.unit, price: harga, label: `${i.code} - ${i.name} (Rp ${rupiah(harga)})` };
                            }));
                            if (v && !barang.length) webix.message({ type: "error", text: "Belum ada barang dari supplier ini yang didaftarkan. Admin perlu menambahkannya di menu Barang dan Stok.", expire: 5000 });
                        }
                    }
                },
                { view: "text", name: "note", label: "Catatan" }
            ],
            onBarisBerubah: n => { const el = $$("po_supplier"); if (el) (n > 0 ? el.disable() : el.enable()); },
            onKirim: (v, baris) => panggilApi("POST", "/api/purchase-orders", { supplier_id: v.supplier_id, note: v.note, lines: baris }).then(() => {
                webix.message({ type: "success", text: "PO dibuat. Status: Ordered (dikirim ke supplier)" });
                HALAMAN.pos.muat();
            })
        });
    });
}

const KONDISI_BARANG = ["Sesuai", "Rusak", "Kelebihan", "Salah Barang", "Lainnya"];

function jendelaTerima(po) {
    const T = "grid_terima";
    let urut = 0;
    const baris = po.lines.map(l => ({
        id: ++urut, item_id: l.item_id, code: l.code, name: l.name, ordered: l.qty, received: l.received || 0,
        qty: l.qty - (l.received || 0), condition: "Sesuai", note: ""
    })).filter(r => r.qty > 0);
    function tambahKlaim() {
        const sel = $$(T).getSelectedItem() || $$(T).getItem($$(T).getFirstId());
        if (!sel) return;
        $$(T).add({ id: ++urut, item_id: sel.item_id, code: sel.code, name: sel.name, ordered: sel.ordered, received: sel.received, qty: 1, condition: "Rusak", note: "" });
    }
    bukaJendela({
        view: "window", id: "win_terima", head: "Cek dan Terima Barang - " + po.number, modal: true, position: "center", width: 940, close: true,
        body: {
            rows: [
                { template: "Isi <b>Qty Terima</b> dan <b>Kondisi</b> (klik sel untuk mengubah). <b>Sesuai</b>: stok bertambah. <b>Rusak / Kelebihan / Salah Barang / Lainnya</b>: dicatat sebagai klaim ke supplier (stok tidak bertambah). Jika sebagian barang datang rusak, klik <b>Tambah Baris Klaim</b> untuk memisahkan barisnya. Kekurangan kuantitas cukup diisi sebesar qty yang datang; sisanya tetap menunggu atau ditutup Manager.", height: 96, borderless: true },
                {
                    view: "datatable", id: T, height: 260, editable: true, editaction: "click", select: true, data: baris, columns: [
                        { id: "code", header: "Kode", width: 90 }, { id: "name", header: "Barang", fillspace: true },
                        { id: "ordered", header: "Dipesan", width: 80 }, { id: "received", header: "Sudah diterima", width: 110 },
                        { id: "qty", header: "Qty Terima", width: 100, editor: "text" },
                        { id: "condition", header: "Kondisi", width: 130, editor: "select", options: KONDISI_BARANG },
                        { id: "note", header: "Catatan", width: 170, editor: "text" }
                    ]
                },
                {
                    cols: [tombol("Tambah Baris Klaim", tambahKlaim), {}, {
                        view: "button", value: "Simpan Penerimaan", width: 190, css: "webix_primary", click: () => {
                            $$(T).editStop();
                            const lines = $$(T).serialize().map(r => ({ item_id: r.item_id, qty: +r.qty || 0, condition: r.condition, note: r.note }));
                            panggilApi("POST", `/api/purchase-orders/${po.id}/receive`, { lines: lines }).then(() => {
                                $$("win_terima").close();
                                webix.message({ type: "success", text: "Penerimaan tersimpan" });
                                HALAMAN.pos.muat();
                            });
                        }
                    }, { view: "button", value: "Batal", width: 100, click: () => $$("win_terima").close() }]
                }
            ]
        }
    });
}

const STATUS_KLAIM = ["Terbuka", "Diganti", "Refund", "Ditutup"];

// Manager menindaklanjuti klaim: ubah status lewat kolom Status (langsung tersimpan)
function jendelaKlaim(po) {
    const T = "grid_klaim";
    const baris = (po.claims || []).map((c, i) => ({
        id: i + 1, idx: i, at: c.at, name: c.name, qty: c.qty, type: c.type || "Lainnya", note: c.note, status: c.status || "Terbuka"
    }));
    if (!baris.length) { webix.message({ type: "error", text: "PO ini belum memiliki klaim" }); return; }
    bukaJendela({
        view: "window", id: "win_klaim", head: "Klaim ke Supplier - " + po.number, modal: true, position: "center", width: 860, close: true,
        body: {
            rows: [
                { template: "Klik kolom <b>Status</b> untuk memperbarui tindak lanjut klaim (Terbuka, Diganti, Refund, Ditutup). Perubahan langsung tersimpan.", height: 48, borderless: true },
                {
                    view: "datatable", id: T, height: 260, editable: true, editaction: "click", data: baris, columns: [
                        { id: "at", header: "Waktu", width: 140, format: fmtTanggal }, { id: "name", header: "Barang", fillspace: true },
                        { id: "qty", header: "Qty", width: 60 }, { id: "type", header: "Jenis", width: 110 }, { id: "note", header: "Catatan", width: 170 },
                        { id: "status", header: "Status", width: 110, editor: "select", options: STATUS_KLAIM }
                    ],
                    on: {
                        onAfterEditStop(state, ed) {
                            if (state.value === state.old) return;
                            const r = this.getItem(ed.row);
                            panggilApi("POST", `/api/purchase-orders/${po.id}/claims/${r.idx}`, { status: r.status }).then(() => {
                                webix.message({ type: "success", text: "Status klaim diperbarui" });
                                HALAMAN.pos.muat();
                            }).catch(() => { r.status = state.old; this.refresh(ed.row); });
                        }
                    }
                },
                { cols: [{}, { view: "button", value: "Tutup", width: 100, click: () => $$("win_klaim").close() }] }
            ]
        }
    });
}

function halamanPO() {
    const G = "grid_pos";
    const muat = () => panggilApi("GET", "/api/purchase-orders").then(res => isiGrid(G, res.data));
    function aksi(nama, teks, alasanWajib) {
        const r = pilihBaris(G); if (!r) return;
        mintaAlasan(`${teks} ${r.number}`, alasan => panggilApi("POST", `/api/purchase-orders/${r.id}/${nama}`, { reason: alasan }).then(() => {
            webix.message({ type: "success", text: "Berhasil" }); muat();
        }), alasanWajib);
    }
    const bar = [kotakCari(G), tombol("Refresh", muat), tombol("Detail", () => { const r = pilihBaris(G); if (r) tampilDetail(r.number, detailPO(r)); })];
    if (userAktif.role === "manager") bar.push(
        tombol("Buat PO", bukaFormPO, "webix_primary"),
        tombol("Batalkan PO", () => aksi("cancel", "Batalkan PO", true)),
        tombol("Tutup PO (Kurang)", () => aksi("close", "Tutup PO dengan kekurangan", true)),
        tombol("Kelola Klaim", () => { const r = pilihBaris(G); if (r) jendelaKlaim(r); }));
    if (userAktif.role === "staff") bar.push(tombol("Cek dan Terima Barang", () => {
        const r = pilihBaris(G); if (!r) return;
        if (!["Ordered", "Partially Received"].includes(r.status)) { webix.message({ type: "error", text: "PO harus berstatus Ordered / Partially Received" }); return; }
        jendelaTerima(r);
    }, "webix_primary"));
    bar.push({});
    return {
        muat: muat,
        ui: {
            id: "pos", rows: [judul("Purchase Order dan Barang Masuk"), { template: "<b>Ordered</b>: sudah dipesan ke supplier. <b>Partially Received</b>: sebagian barang sudah datang. <b>Tutup PO (Kurang)</b>: dipakai Manager bila sisa barang tidak akan dikirim supplier lagi, sehingga PO dinyatakan selesai. <b>Klaim</b>: barang datang rusak / berlebih / salah.", height: 62, borderless: true }, { view: "toolbar", elements: bar }, buatGrid(G, [
                { id: "number", header: "No. PO", width: 110, sort: "string" }, { id: "supplier", header: "Supplier", width: 180, sort: "string" },
                { id: "lines", header: "Barang (diterima/dipesan)", fillspace: true, minWidth: 220, template: o => esc(o.lines.map(l => `${l.name} ${l.received || 0}/${l.qty}`).join(", ")) },
                { id: "total", header: "Total (Rp)", width: 120, format: webix.i18n.numberFormat, css: { "text-align": "right" } },
                { id: "status", header: "Status", width: 150, sort: "string", template: o => badge(o.status) },
                {
                    id: "claims", header: "Klaim", width: 100, template: o => {
                        const cl = o.claims || [], terbuka = cl.filter(c => (c.status || "Terbuka") === "Terbuka").length;
                        return terbuka ? `<span class="low">${terbuka} terbuka</span>` : (cl.length ? "selesai" : "-");
                    }
                },
                { id: "creator", header: "Dibuat oleh", width: 140 }, { id: "created_at", header: "Tanggal", width: 150, format: fmtTanggal }
            ], dblKlik(r => tampilDetail(r.number, detailPO(r))))]
        }
    };
}
