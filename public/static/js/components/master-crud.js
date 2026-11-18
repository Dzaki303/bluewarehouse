/* Komponen: generator halaman master data (CRUD) */

// Pola sama dengan contoh: form tambah di atas, datatable dengan ikon edit/hapus, popup edit.
function buatElemen(prefix, f, mode, opsiSiap) {
    const el = { view: f.view || "text", id: prefix + f.name, name: f.name, label: f.label };
    if (f.placeholder) el.placeholder = f.placeholder;
    if (f.type) el.type = f.type;
    if (f.value !== undefined) el.value = f.value;
    if (f.min !== undefined) el.min = f.min;
    if (f.labelRight) { el.labelRight = f.labelRight; el.labelWidth = 0; el.label = ""; }
    if (f.required || (mode === "tambah" && f.wajibTambah)) el.required = true;
    if (f.options) el.options = f.options;
    if (f.optionsFrom) el.options = (opsiSiap && opsiSiap[f.name]) || [];
    return el;
}

async function ambilOpsi(fields) {
    const hasil = {};
    for (const f of fields.filter(x => x.optionsFrom)) {
        const res = await panggilApi("GET", f.optionsFrom);
        hasil[f.name] = res.data.map(d => d.name);
    }
    return hasil;
}

function halamanMaster(o) {
    const idGrid = "grid_" + o.id, idForm = "form_" + o.id;
    const bolehTulis = o.roleTulis.includes(userAktif.role);

    function muatData() {
        panggilApi("GET", o.url).then(res => isiGrid(idGrid, res.data));
        // opsi dropdown pada form tambah (kategori, warehouse) dimuat ulang tiap halaman dibuka
        if (!bolehTulis || o.tanpaFormTambah) return;
        o.fields.filter(f => f.optionsFrom).forEach(f => {
            panggilApi("GET", f.optionsFrom).then(res => {
                const list = $$("tambah_" + o.id + "_" + f.name).getList();
                list.clearAll();
                list.parse(res.data.map(d => ({ id: d.name, value: d.name })));
            });
        });
    }

    function tambahData() {
        const form = $$(idForm);
        if (!form.validate()) { webix.message({ type: "error", text: "Lengkapi isian yang wajib diisi" }); return; }
        panggilApi("POST", o.url, o.kirim ? o.kirim(form.getValues()) : form.getValues()).then(() => {
            webix.message({ type: "success", text: o.judul + " berhasil ditambahkan" });
            form.clear();
            form.clearValidation();
            form.setValues(o.nilaiAwal || {});
            muatData();
        });
    }

    async function bukaFormEdit(item) {
        const prefix = "edit_" + o.id + "_", idWin = "win_edit_" + o.id;
        const opsi = await ambilOpsi(o.fields);
        bukaJendela({
            view: "window", id: idWin, head: "Edit " + o.judul, position: "center", modal: true, width: 420, close: true,
            body: {
                view: "form", id: "formEdit_" + o.id, elementsConfig: { labelWidth: 100 },
                elements: [
                    ...o.fields.map(f => buatElemen(prefix, f, "edit", opsi)),
                    {
                        cols: [
                            { view: "button", value: "Simpan", css: "webix_primary", click: () => simpanEdit(item.id) },
                            { view: "button", value: "Batal", click: () => $$(idWin).close() }
                        ]
                    }
                ]
            }
        });
        $$("formEdit_" + o.id).setValues(o.siapkanEdit ? o.siapkanEdit(item) : item);
    }

    function simpanEdit(id) {
        const form = $$("formEdit_" + o.id);
        if (!form.validate()) { webix.message({ type: "error", text: "Lengkapi isian yang wajib diisi" }); return; }
        panggilApi("PUT", `${o.url}/${id}`, o.kirim ? o.kirim(form.getValues()) : form.getValues()).then(() => {
            webix.message({ type: "success", text: o.judul + " berhasil diperbarui" });
            $$("win_edit_" + o.id).close();
            muatData();
        });
    }

    function hapusData(id) {
        panggilApi("DELETE", `${o.url}/${id}`).then(() => {
            webix.message({ type: "success", text: o.judul + " berhasil dihapus" });
            muatData();
        });
    }

    // form tambah: dua kolom per baris, tombol di baris terakhir (seperti contoh)
    const baris = [];
    for (let i = 0; i < o.fields.length; i += 2) {
        baris.push(o.fields.slice(i, i + 2).map(f => buatElemen("tambah_" + o.id + "_", f, "tambah")));
    }
    const tombolTambah = { view: "button", value: "Tambah Data", css: "webix_primary", width: 150, click: tambahData };
    const terakhir = baris[baris.length - 1];
    if (terakhir.length === 1) terakhir.push(tombolTambah); else baris.push([{}, tombolTambah]);

    const formTambah = {
        view: "form", id: idForm, borderless: true, elementsConfig: { labelWidth: 100 },
        elements: [{ view: "label", label: "Tambah " + o.judul + " Baru", css: "webix_header" }, ...baris.map(r => ({ cols: r }))]
    };

    const kolom = o.columns.slice();
    if (bolehTulis && !o.tanpaEditHapus) {
        kolom.push({ id: "edit", header: "", width: 50, template: "{common.editIcon()}" });
        kolom.push({ id: "hapus", header: "", width: 60, template: "{common.trashIcon()}" });
    }

    const grid = buatGrid(idGrid, kolom, {
        onClick: {
            "wxi-pencil": function (ev, id) { bukaFormEdit(this.getItem(id)); return false; },
            "wxi-trash": function (ev, id) {
                const item = this.getItem(id);
                webix.confirm({
                    title: "Konfirmasi Hapus",
                    text: `Yakin ingin menghapus <b>${esc(item[o.kolomNama || "name"])}</b>?`,
                    ok: "Ya, Hapus", cancel: "Batal"
                }).then(() => hapusData(item.id));
                return false;
            }
        }
    });

    const bar = [kotakCari(idGrid)];
    (o.tombolExtra || []).forEach(fn => bar.push(fn(idGrid)));
    bar.push({});

    const isi = [judul(o.judulHalaman)];
    if (bolehTulis && !o.tanpaFormTambah) { isi.push(formTambah); isi.push({ view: "resizer" }); }
    isi.push({ view: "toolbar", elements: bar }, grid);

    return { muat: muatData, ui: { id: o.id, rows: isi } };
}
