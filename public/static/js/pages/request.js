/* Transaksi: Request Barang */

function bukaFormRequest(preselect) {
    panggilApi("GET", "/api/items").then(res => jendelaBaris({
        id: "win_request", judul: "Request Barang Baru", items: res.data, preselect: preselect, labelKirim: "Kirim Request",
        fields: [{ view: "text", name: "purpose", label: "Keperluan" }],
        onKirim: (v, baris) => panggilApi("POST", "/api/requests", { purpose: v.purpose, lines: baris }).then(() => {
            webix.message({ type: "success", text: "Request terkirim. Status: Menunggu approval Manager" });
            if ($$("grid_requests")) HALAMAN.requests.muat();
        })
    }));
}

function detailRequest(r) {
    return `<div class="dtl"><div class="meta"><b>${esc(r.number)}</b> ${badge(r.status)}<br>Pemohon: ${esc(r.requester)} (${esc(r.requester_role)})<br>
        Keperluan: ${esc(r.purpose || "-")}<br>Dibuat: ${fmtTanggal(r.created_at)}<br>Approver: ${esc(r.approver || "-")} ${r.reject_reason ? " - " + esc(r.reject_reason) : ""}</div>
        <h4>Barang</h4>${buatTabel(["Kode", "Barang", "Qty"], r.lines.map(l => [l.code, l.name, `${l.qty} ${l.unit}`]))}
        <h4>Riwayat</h4>${buatTabel(["Waktu", "Oleh", "Aksi"], r.history.map(h => [fmtTanggal(h.at), h.by, h.action]))}</div>`;
}

function halamanRequest() {
    const G = "grid_requests";
    const muat = () => panggilApi("GET", "/api/requests").then(res => isiGrid(G, res.data));
    function aksi(nama, teks, tanyaAlasan) {
        const r = pilihBaris(G); if (!r) return;
        const jalankan = alasan => panggilApi("POST", `/api/requests/${r.id}/${nama}`, { reason: alasan }).then(() => {
            webix.message({ type: "success", text: "Berhasil" }); muat();
        });
        if (tanyaAlasan) mintaAlasan(`${teks} ${r.number}`, jalankan); else konfirmasi(`${teks} ${esc(r.number)}?`, () => jalankan(""));
    }
    const bar = [kotakCari(G), tombol("Refresh", muat),
        tombol("Detail", () => { const r = pilihBaris(G); if (r) tampilDetail(r.number, detailRequest(r)); })];
    if (userAktif.role === "staff") bar.push(tombol("Request Baru", () => bukaFormRequest(), "webix_primary"));
    if (userAktif.role === "manager") bar.push(tombol("Setujui", () => aksi("approve", "Setujui request", false)), tombol("Tolak", () => aksi("reject", "Tolak request", true)));
    if (userAktif.role === "staff") bar.push(tombol("Input Barang Keluar dan Serahkan", () => aksi("fulfill", "Input barang keluar dan serahkan untuk", false), "webix_primary"));
    bar.push({});
    return {
        muat: muat,
        ui: {
            id: "requests", rows: [judul("Request Barang"), { view: "toolbar", elements: bar }, buatGrid(G, [
                { id: "number", header: "No. Request", width: 120, sort: "string" }, { id: "requester", header: "Pemohon", width: 160, sort: "string" },
                { id: "lines", header: "Barang", fillspace: true, minWidth: 220, template: o => esc(o.lines.map(l => `${l.name} x${l.qty}`).join(", ")) },
                { id: "status", header: "Status", width: 130, sort: "string", template: o => badge(o.status) },
                { id: "created_at", header: "Dibuat", width: 150, format: fmtTanggal }, { id: "approver", header: "Approver", width: 140 }
            ], dblKlik(r => tampilDetail(r.number, detailRequest(r))))]
        }
    };
}
