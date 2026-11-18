/* Master data: Pengguna */

function halamanPengguna() {
    return halamanMaster({
        id: "users", judul: "Pengguna", judulHalaman: "Manajemen Pengguna", url: "/api/users", roleTulis: ["admin"], kolomNama: "username",
        nilaiAwal: { active: 1 },
        siapkanEdit: r => Object.assign({}, r, { active: r.active ? 1 : 0, password: "" }),
        fields: [
            { name: "username", label: "Username", required: true }, { name: "full_name", label: "Nama Lengkap", required: true },
            { name: "role", label: "Role", view: "richselect", required: true, options: ["admin", "manager", "staff", "supplier"] },
            { name: "password", label: "Password", type: "password", wajibTambah: true, placeholder: "kosongkan jika tidak diubah" },
            { name: "active", view: "checkbox", labelRight: "Akun aktif", value: 1 }
        ],
        columns: [
            { id: "username", header: "Username", width: 160, sort: "string" }, { id: "full_name", header: "Nama Lengkap", fillspace: true, sort: "string" },
            { id: "role", header: "Role", width: 140, template: o => LABEL_ROLE[o.role] || o.role },
            { id: "active", header: "Aktif", width: 80, template: o => o.active ? "Ya" : "Tidak" }, { id: "created_at", header: "Dibuat", width: 150, format: fmtTanggal }
        ]
    });
}
