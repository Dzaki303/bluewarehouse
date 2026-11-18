/* Core: helper komponen Webix (window, grid, dialog) */

function bukaJendela(config) {
    if ($$(config.id)) $$(config.id).close();
    const w = webix.ui(config);
    w.show();
    return w;
}
function judul(teks) { return { view: "toolbar", elements: [{ view: "label", label: teks }] }; }
function tombol(label, fn, css) { return { view: "button", value: label, autowidth: true, css: css || "", click: fn }; }
function kotakCari(idGrid) {
    return {
        view: "search", placeholder: "Cari...", width: 240,
        on: { onTimedKeyPress() { const q = this.getValue().toLowerCase(); $$(idGrid).filter(o => JSON.stringify(Object.values(o)).toLowerCase().includes(q)); } }
    };
}
function pilihBaris(idGrid) {
    const r = $$(idGrid).getSelectedItem();
    if (!r) webix.message({ type: "error", text: "Pilih satu baris terlebih dahulu" });
    return r;
}
function buatGrid(id, kolom, extra) {
    return Object.assign({ view: "datatable", id: id, columns: kolom, select: true, resizeColumn: true, scroll: "auto", data: [] }, extra || {});
}
function isiGrid(id, data) { $$(id).clearAll(); $$(id).parse(data); }
function tampilDetail(judulJendela, html) {
    bukaJendela({ view: "window", id: "win_detail", head: judulJendela, modal: true, position: "center", width: 680, height: 520, close: true,
        body: { view: "template", scroll: "y", template: html } });
}
function konfirmasi(teks, fn) { webix.confirm({ title: "Konfirmasi", text: teks, ok: "Ya", cancel: "Batal" }).then(fn); }
function mintaAlasan(judulPrompt, fn, wajib) {
    webix.prompt({ title: judulPrompt, ok: "Kirim", cancel: "Batal", input: { placeholder: wajib ? "Alasan (wajib diisi)" : "Alasan (opsional)" } }).then(fn);
}
function dblKlik(fnDetail) {
    return { on: { onItemDblClick(id) { fnDetail(this.getItem(id.row)); } } };
}
