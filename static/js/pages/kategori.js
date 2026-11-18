/* Master data: Kategori */

function halamanKategori() {
    return halamanMaster({
        id: "categories", judul: "Kategori", judulHalaman: "Kategori Barang", url: "/api/categories", roleTulis: ["admin"],
        fields: [{ name: "name", label: "Nama", required: true }, { name: "description", label: "Deskripsi" }],
        columns: [{ id: "name", header: "Nama Kategori", width: 260, sort: "string" }, { id: "description", header: "Deskripsi", fillspace: true }]
    });
}
