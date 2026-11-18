/* Master data: Supplier (lihat produk, import, akun portal) */

// Supplier = pihak luar yang sudah punya daftar produk dan harga. Admin menginput data supplier di sini;
// produk dan harganya dikelola oleh supplier sendiri lewat portal, atau oleh Admin lewat Import JSON;
// produk itu kemudian didaftarkan menjadi barang lewat Barang dan Stok > Tambah Barang dari Supplier.
function halamanSupplier() {
    return halamanMaster({
        id: "suppliers", judul: "Supplier", judulHalaman: "Data Supplier", url: "/api/suppliers", roleTulis: ["admin"],
        tanpaEditHapus: true,   // tabel supplier hanya dibaca (tanpa ikon edit dan hapus)
        fields: [
            { name: "name", label: "Nama", required: true }, { name: "contact", label: "Kontak" },
            { name: "phone", label: "Telepon" }, { name: "email", label: "Email" }, { name: "address", label: "Alamat" }
        ],
        columns: [
            { id: "name", header: "Nama Supplier", width: 200, sort: "string" }, { id: "contact", header: "Kontak", width: 120 },
            { id: "phone", header: "Telepon", width: 130 }, { id: "email", header: "Email", width: 200 },
            { id: "products", header: "Produk", width: 90, template: o => (o.products || []).length + " produk" },
            { id: "address", header: "Alamat", fillspace: true }
        ],
        tombolExtra: [
            idGrid => tombol("Lihat Produk dan Harga", () => { const r = pilihBaris(idGrid); if (r) lihatProdukSupplier(r); }, "webix_primary")
        ]
    });
}

// Import supplier beserta produk dan harga dari JSON (tempel teks atau pilih file .json)
const CONTOH_JSON = JSON.stringify([{
    name: "PT Contoh Supplier", contact: "Budi", phone: "081200000099", email: "sales@contoh.example", address: "Jakarta",
    products: [
        { sku: "CS-001", name: "Produk A", unit: "pcs", price: 100000 },
        { sku: "CS-002", name: "Produk B", unit: "box", price: 250000 }
    ]
}], null, 2);

function bukaImportSupplier() {
    const TA = "imp_json";
    function kirim() {
        const teks = String($$(TA).getValue()).trim();
        if (!teks) { webix.message({ type: "error", text: "Isi JSON terlebih dahulu" }); return; }
        let data;
        try { data = JSON.parse(teks); }
        catch (e) { webix.message({ type: "error", text: "Format JSON tidak valid: " + e.message, expire: 6000 }); return; }
        panggilApi("POST", "/api/suppliers/import", data).then(res => {
            $$("win_import_sup").close();
            const bagian = [];
            if (res.ditambahkan.length) bagian.push(res.ditambahkan.length + " supplier ditambahkan");
            if (res.diperbarui.length) bagian.push(res.diperbarui.length + " supplier diperbarui");
            webix.message({ type: "success", text: `Import berhasil: ${bagian.join(", ")} (${res.produk} produk diproses)`, expire: 6000 });
            HALAMAN.suppliers.muat();
        });
    }
    bukaJendela({
        view: "window", id: "win_import_sup", head: "Import Supplier dan Produk (JSON)", modal: true, position: "center", width: 720, close: true,
        body: {
            rows: [
                { template: "Tempel JSON atau pilih file <b>.json</b>. Satu objek atau daftar supplier, masing-masing berisi <b>products</b> (sku, name, unit, price). Supplier baru ditambahkan; supplier yang namanya sudah ada diperbarui (produk dengan SKU sama diperbarui harganya, SKU baru ditambahkan, produk lain tidak dihapus).", height: 82, borderless: true },
                {
                    cols: [
                        {
                            view: "uploader", value: "Pilih File JSON", autosend: false, multiple: false, accept: "application/json,.json", width: 160, link: null,
                            on: {
                                onBeforeFileAdd(file) {
                                    const fr = new FileReader();
                                    fr.onload = () => $$(TA).setValue(fr.result);
                                    fr.readAsText(file.file);
                                    return false;
                                }
                            }
                        },
                        { view: "button", value: "Isi Contoh Format", width: 150, click: () => $$(TA).setValue(CONTOH_JSON) },
                        {}
                    ]
                },
                { view: "textarea", id: TA, height: 300, placeholder: "[ { \"name\": \"PT ...\", \"products\": [ { \"sku\": \"...\", \"name\": \"...\", \"unit\": \"pcs\", \"price\": 100000 } ] } ]" },
                { cols: [{}, { view: "button", value: "Import", width: 130, css: "webix_primary", click: kirim }, { view: "button", value: "Batal", width: 100, click: () => $$("win_import_sup").close() }] }
            ]
        }
    });
}

// Akun portal: supplier login di /portal untuk mengelola profil dan daftar produk/harganya sendiri
function bukaAkunPortal(sup) {
    function simpan() {
        const form = $$("form_akun_portal");
        if (!form.validate()) return;
        panggilApi("POST", `/api/suppliers/${sup.id}/account`, form.getValues()).then(() => {
            $$("win_akun_portal").close();
            webix.message({ type: "success", text: "Akun portal dibuat. Berikan username dan password ke supplier; alamat portal: " + location.origin + "/portal", expire: 8000 });
        });
    }
    bukaJendela({
        view: "window", id: "win_akun_portal", head: "Akun Portal - " + sup.name, modal: true, position: "center", width: 420, close: true,
        body: {
            view: "form", id: "form_akun_portal", elementsConfig: { labelWidth: 100 }, elements: [
                { template: "Supplier masuk lewat alamat <b>/portal</b> dan hanya dapat mengelola profil dan produk miliknya.", height: 50, borderless: true },
                { view: "text", name: "username", label: "Username", required: true },
                { view: "text", name: "password", label: "Password", type: "password", required: true, placeholder: "minimal 6 karakter" },
                { cols: [{}, { view: "button", value: "Buat Akun", width: 130, css: "webix_primary", click: simpan }, { view: "button", value: "Batal", width: 100, click: () => $$("win_akun_portal").close() }] }
            ]
        }
    });
}

// Lihat produk dan harga supplier (hanya baca).
// Perubahan produk/harga dilakukan supplier sendiri lewat portal (/portal) atau Admin lewat Import JSON.
function lihatProdukSupplier(sup) {
    const T = "grid_produk_sup";
    const baris = (sup.products || []).map(p => ({ id: p.sku, sku: p.sku, name: p.name, unit: p.unit, price: p.price }));
    bukaJendela({
        view: "window", id: "win_produk_sup", head: "Produk dan Harga - " + sup.name, modal: true, position: "center", width: 820, close: true,
        body: {
            rows: [
                { template: "Daftar produk yang dijual supplier ini beserta harganya. <b>Hanya untuk dilihat</b> - produk dan harga diperbarui oleh supplier sendiri melalui <b>Portal Supplier</b>, atau oleh Admin lewat <b>Import JSON</b>. Produk ini yang sudah terdaftar didaftarkan menjadi barang lewat <b>Barang dan Stok &gt; Tambah Barang dari Supplier</b>.", height: 62, borderless: true },
                {
                    view: "datatable", id: T, height: 300, readonly: true, data: baris,
                    columns: [
                        { id: "sku", header: "SKU", width: 110 },
                        { id: "name", header: "Nama Produk", fillspace: true },
                        { id: "unit", header: "Satuan", width: 90 },
                        { id: "price", header: "Harga (Rp)", width: 140, format: webix.i18n.numberFormat, css: { "text-align": "right" } }
                    ]
                },
                { cols: [{}, { view: "button", value: "Tutup", width: 100, click: () => $$("win_produk_sup").close() }] }
            ]
        }
    });
}
