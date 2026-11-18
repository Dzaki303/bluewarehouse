/* Master data: Warehouse */

function halamanWarehouse() {
    return halamanMaster({
        id: "warehouses", judul: "Warehouse", judulHalaman: "Warehouse dan Lokasi", url: "/api/warehouses", roleTulis: ["admin"],
        fields: [{ name: "name", label: "Nama", required: true }, { name: "address", label: "Alamat" }],
        columns: [{ id: "name", header: "Nama Warehouse", width: 260, sort: "string" }, { id: "address", header: "Alamat / Keterangan", fillspace: true }]
    });
}
