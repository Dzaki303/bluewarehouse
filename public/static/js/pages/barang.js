/* Master data: Barang dan Stok */

const BLOK_RAK = ["A", "B", "C", "D", "E", "F"];

// Barang = produk supplier yang didaftarkan Admin. Supplier adalah pihak luar (hidden entity):
// nama, satuan, dan harga produk sudah dari supplier, Admin tinggal memilih dan melengkapi data gudang.
function halamanBarang() {
    return halamanMaster({
        id: "items", judul: "Barang", judulHalaman: "Barang dan Stok", url: "/api/items", roleTulis: ["admin"],
        tanpaFormTambah: true,   // penambahan lewat tombol "Tambah Barang dari Supplier"; ikon pensil untuk edit
        fields: [
            { name: "code", label: "Kode", required: true },
            { name: "name", label: "Nama Barang", required: true },
            { name: "category", label: "Kategori", view: "richselect", required: true, optionsFrom: "/api/categories" },
            { name: "warehouse", label: "Warehouse", view: "richselect", optionsFrom: "/api/warehouses" },
            { name: "rak_blok", label: "Rak (Blok)", view: "richselect", options: BLOK_RAK, placeholder: "Pilih A / B / C..." },
            { name: "rak_no", label: "No. Rak", view: "counter", value: 1, min: 1 },
            { name: "unit", label: "Satuan" },
            { name: "min_stock", label: "Stok Min", view: "counter", value: 0, min: 0 }
        ],
        // blok + nomor digabung menjadi lokasi rak, misalnya A + 3 -> "A-03"
        kirim: v => {
            const d = Object.assign({}, v);
            d.location = d.rak_blok ? `${d.rak_blok}-${String(+d.rak_no || 1).padStart(2, "0")}` : "";
            delete d.rak_blok; delete d.rak_no;
            return d;
        },
        siapkanEdit: item => {
            const m = /^([A-Z])-(\d+)$/.exec(item.location || "");
            return Object.assign({}, item, { rak_blok: m ? m[1] : "", rak_no: m ? +m[2] : 1 });
        },
        columns: [
            { id: "code", header: "Kode", width: 100, sort: "string" }, { id: "name", header: "Nama Barang", fillspace: true, minWidth: 180, sort: "string" },
            { id: "supplier", header: "Supplier", width: 150, sort: "string" },
            { id: "category", header: "Kategori", width: 120, sort: "string" }, { id: "warehouse", header: "Warehouse", width: 120, sort: "string" },
            { id: "location", header: "Rak", width: 70 },
            { id: "stock", header: "Stok", width: 70, sort: "int", template: o => o.stock <= o.min_stock ? `<span class="low">${o.stock}</span>` : o.stock },
            { id: "min_stock", header: "Min", width: 55 }, { id: "unit", header: "Satuan", width: 70 },
            { id: "purchase_price", header: "Harga Beli", width: 110, format: webix.i18n.numberFormat, css: { "text-align": "right" } }
        ],
        tombolExtra: userAktif.role === "admin"
            ? [() => tombol("Tambah Barang dari Supplier", bukaTambahBarang, "webix_primary")]
            : [idGrid => tombol("Buat Request dari Barang Terpilih", () => { const r = pilihBaris(idGrid); if (r) bukaFormRequest(r.id); })]
    });
}

function bukaTambahBarang() {
    Promise.all([panggilApi("GET", "/api/suppliers"), panggilApi("GET", "/api/items"),
        panggilApi("GET", "/api/categories"), panggilApi("GET", "/api/warehouses")]).then(([sp, it, ct, wh]) => {
        const supplier = {};
        sp.data.forEach(s => { supplier[s.id] = s; });
        const terdaftar = new Set(it.data.filter(i => i.supplier_id).map(i => i.supplier_id + "|" + i.supplier_sku));
        let produk = [];
        const F = "form_tambah_barang";

        function simpan() {
            const form = $$(F);
            if (!form.validate()) { webix.message({ type: "error", text: "Lengkapi isian yang wajib diisi" }); return; }
            const v = form.getValues();
            if (terdaftar.has(v.supplier_id + "|" + v.supplier_sku)) { webix.message({ type: "error", text: "Produk ini sudah terdaftar sebagai barang" }); return; }
            const data = {
                supplier_id: v.supplier_id, supplier_sku: v.supplier_sku, code: v.code, category: v.category,
                warehouse: v.warehouse, min_stock: +v.min_stock || 0,
                location: v.rak_blok ? `${v.rak_blok}-${String(+v.rak_no || 1).padStart(2, "0")}` : ""
            };
            panggilApi("POST", "/api/items", data).then(() => {
                $$("win_tambah_barang").close();
                webix.message({ type: "success", text: "Barang berhasil ditambahkan" });
                HALAMAN.items.muat();
            });
        }

        bukaJendela({
            view: "window", id: "win_tambah_barang", head: "Tambah Barang dari Supplier", modal: true, position: "center", width: 580, close: true,
            body: {
                view: "form", id: F, elementsConfig: { labelWidth: 130 },
                elements: [
                    { template: "Langkah: <b>1)</b> pilih supplier, <b>2)</b> pilih produk dari daftar supplier (nama, satuan, dan harga sudah dari supplier), <b>3)</b> lengkapi kode, kategori, dan lokasi gudang.", height: 64, borderless: true },
                    {
                        view: "richselect", id: "tb_supplier", name: "supplier_id", label: "Supplier", required: true,
                        options: sp.data.map(s => ({ id: s.id, value: s.name })),
                        on: {
                            onChange(v) {
                                produk = ((supplier[v] || {}).products) || [];
                                const list = $$("tb_produk").getList();
                                list.clearAll();
                                list.parse(produk.map(p => ({
                                    id: p.sku,
                                    value: `${p.name} - Rp ${rupiah(p.price)} / ${p.unit}` + (terdaftar.has(v + "|" + p.sku) ? "  (sudah terdaftar)" : "")
                                })));
                                $$("tb_produk").setValue("");
                                $$("tb_info").setHTML("");
                            }
                        }
                    },
                    {
                        view: "richselect", id: "tb_produk", name: "supplier_sku", label: "Produk Supplier", required: true, options: [],
                        placeholder: "Pilih supplier terlebih dahulu...",
                        on: {
                            onChange(sku) {
                                const p = produk.find(x => x.sku === sku);
                                $$("tb_info").setHTML(p ? `Nama: <b>${esc(p.name)}</b> &nbsp;|&nbsp; Satuan: <b>${esc(p.unit)}</b> &nbsp;|&nbsp; Harga dari supplier: <b>Rp ${rupiah(p.price)}</b>` : "");
                            }
                        }
                    },
                    { view: "template", id: "tb_info", height: 40, borderless: true, template: "#html#", data: { html: "" } },
                    { view: "text", name: "code", label: "Kode Barang", value: "BRG-", required: true, placeholder: "BRG- lalu nomor, cth: BRG-006" },
                    { view: "richselect", name: "category", label: "Kategori", required: true, options: ct.data.map(c => c.name) },
                    { view: "richselect", name: "warehouse", label: "Warehouse", options: wh.data.map(w => w.name) },
                    {
                        cols: [
                            { view: "richselect", name: "rak_blok", label: "Rak (Blok)", options: BLOK_RAK, placeholder: "A / B / C..." },
                            { view: "counter", name: "rak_no", label: "No. Rak", labelWidth: 70, value: 1, min: 1 }
                        ]
                    },
                    { view: "counter", name: "min_stock", label: "Stok Minimum", value: 0, min: 0 },
                    { cols: [{}, { view: "button", value: "Simpan Barang", width: 160, css: "webix_primary", click: simpan }, { view: "button", value: "Batal", width: 100, click: () => $$("win_tambah_barang").close() }] }
                ]
            }
        });
    });
}
