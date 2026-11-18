/* Core: helper format & tampilan umum */

function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtTanggal(v) { return v ? webix.Date.dateToStr("%d-%m-%Y %H:%i")(new Date(v)) : ""; }
function rupiah(v) { return webix.i18n.numberFormat(v || 0); }
function badge(v) { return `<span class="badge ${WARNA_STATUS[v] || ""}">${esc(v)}</span>`; }
function buatTabel(header, baris) {
    return "<table class='dt'><tr>" + header.map(h => `<th>${esc(h)}</th>`).join("") + "</tr>" +
        baris.map(r => "<tr>" + r.map(c => `<td>${esc(c)}</td>`).join("") + "</tr>").join("") + "</table>";
}

// Pemanggil REST API (JSON). Pesan error dari server otomatis ditampilkan.
