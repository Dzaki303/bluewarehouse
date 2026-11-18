/* Komponen: editor baris barang (Request & PO) */

// Mengembalikan { setItems(daftar) } agar daftar barang bisa diganti (PO: sesuai katalog supplier yang dipilih).
// Item boleh punya `price` (dari katalog supplier): harga terisi otomatis dan tidak bisa diubah.
// Untuk PO (o.harga) tabel menampilkan Subtotal = qty x harga dan Total di bawah tabel.
// o.onBarisBerubah(jumlahBaris) dipanggil tiap baris bertambah/berkurang (dipakai PO untuk mengunci supplier).
function jendelaBaris(o) {
    const T = o.id + "_grid", CB = o.id + "_item", Q = o.id + "_qty", PR = o.id + "_harga", F = o.id + "_form", TT = o.id + "_total";
    let daftar = [];
    const labelItem = i => i.label || `${i.code} - ${i.name} (stok ${i.stock} ${i.unit})`;
    const kolom = [
        { id: "code", header: "Kode", width: 100 }, { id: "name", header: "Barang", fillspace: true },
        { id: "qty", header: "Qty", width: 80, editor: "text", css: { background: "#fffbe6" } }
    ];
    if (o.harga) {
        kolom.push({ id: "price", header: "Harga satuan", width: 120, format: webix.i18n.numberFormat, css: { "text-align": "right" } });
        kolom.push({ id: "subtotal", header: "Subtotal", width: 130, css: { "text-align": "right" }, template: r => rupiah((+r.qty || 0) * (+r.price || 0)) });
    }
    kolom.push({ id: "hapus", header: "", width: 50, template: "{common.trashIcon()}" });

    function segarkan() {
        const baris = $$(T).serialize();
        if (o.harga) {
            const total = baris.reduce((t, r) => t + (+r.qty || 0) * (+r.price || 0), 0);
            $$(TT).setHTML(`<div style="text-align:right;font-size:15px">Total PO: <b>Rp ${rupiah(total)}</b></div>`);
        }
        if (o.onBarisBerubah) o.onBarisBerubah(baris.length);
    }

    function tambahBaris(item, qty, harga) {
        const ada = $$(T).find(r => r.item_id == item.id)[0];
        if (ada) { ada.qty = (+ada.qty || 0) + qty; if (harga) ada.price = harga; $$(T).updateItem(ada.id, ada); }
        else $$(T).add({ item_id: item.id, code: item.code, name: item.name, qty: qty, price: harga });
        segarkan();
    }

    const barisTambah = [
        {
            view: "combo", id: CB, placeholder: o.placeholder || "Cari dan pilih barang...", options: [],
            on: {
                onChange(id) {
                    if (!o.harga) return;
                    const it = daftar.find(i => i.id == id);
                    if (it && it.price !== undefined) { $$(PR).setValue(it.price); $$(PR).disable(); }
                    else $$(PR).enable();
                }
            }
        },
        { view: "counter", id: Q, label: "Qty", labelWidth: 36, value: 1, min: 1, width: 130 }
    ];
    if (o.harga) barisTambah.push({ view: "counter", id: PR, label: "Harga", labelWidth: 50, value: 0, min: 0, step: 1000, width: 190 });
    barisTambah.push({
        view: "button", value: "Tambah Barang", width: 130, click: () => {
            const id = $$(CB).getValue();
            if (!id) { webix.message({ type: "error", text: o.pesanKosong || "Pilih barang terlebih dahulu" }); return; }
            const item = daftar.find(i => i.id == id);
            const harga = o.harga ? (item.price !== undefined ? item.price : (+$$(PR).getValue() || 0)) : undefined;
            tambahBaris(item, +$$(Q).getValue() || 1, harga);
            $$(CB).setValue(""); $$(Q).setValue(1);
        }
    });

    function kirim() {
        const form = $$(F);
        $$(T).editStop();
        if (!form.validate()) return;
        const baris = $$(T).serialize().map(r => ({ item_id: r.item_id, qty: +r.qty, price: r.price }));
        if (!baris.length) { webix.message({ type: "error", text: "Tambahkan minimal satu barang" }); return; }
        o.onKirim(form.getValues(), baris).then(() => $$(o.id).close());
    }

    const isi = [
        ...(o.fields || []),
        ...(o.petunjuk ? [{ template: o.petunjuk, height: 44, borderless: true }] : []),
        { cols: barisTambah },
        {
            view: "datatable", id: T, height: 230, columns: kolom, data: [], editable: true, editaction: "click",
            onClick: { "wxi-trash": function (e, id) { this.remove(id.row); segarkan(); return false; } },
            on: {
                onAfterEditStop(state, ed) {
                    const r = this.getItem(ed.row);
                    const n = parseInt(r.qty, 10);
                    r.qty = (isNaN(n) || n < 1) ? (state.old || 1) : n;      // qty harus bilangan bulat minimal 1
                    this.refresh(ed.row);
                    segarkan();
                }
            }
        }
    ];
    if (o.harga) isi.push({ view: "template", id: TT, height: 34, borderless: true, template: "#html#", data: { html: "" } });
    isi.push({ cols: [{}, { view: "button", value: o.labelKirim, width: 150, css: "webix_primary", click: kirim }, { view: "button", value: "Batal", width: 100, click: () => $$(o.id).close() }] });

    bukaJendela({
        view: "window", id: o.id, head: o.judul, modal: true, position: "center", width: 800, close: true,
        body: { view: "form", id: F, elementsConfig: { labelWidth: 120 }, elements: isi }
    });

    const ctl = {
        setItems(arr) {
            daftar = arr || [];
            const list = $$(CB).getList();
            list.clearAll();
            list.parse(daftar.map(i => ({ id: i.id, value: labelItem(i) })));
            $$(CB).setValue("");
            if (o.harga) $$(PR).enable();
            $$(T).clearAll();
            segarkan();
        }
    };
    ctl.setItems(o.items || []);
    const awal = daftar.find(i => i.id == o.preselect);
    if (awal) tambahBaris(awal, 1, undefined);
    return ctl;
}
