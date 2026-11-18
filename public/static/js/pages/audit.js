/* Monitoring: Audit Log */

function halamanAudit() {
    const G = "grid_audit";
    const muat = () => panggilApi("GET", "/api/audit-logs").then(res => isiGrid(G, res.data));
    return {
        muat: muat,
        ui: {
            id: "audit", rows: [judul("Audit Log"), { view: "toolbar", elements: [kotakCari(G), tombol("Refresh", muat), {}] }, buatGrid(G, [
                { id: "at", header: "Waktu", width: 150, format: fmtTanggal }, { id: "user", header: "User", width: 120 }, { id: "role", header: "Role", width: 100 },
                { id: "action", header: "Aksi", width: 100 }, { id: "entity", header: "Entitas", width: 140 }, { id: "ref", header: "Ref ID", width: 210 }, { id: "detail", header: "Detail", fillspace: true }
            ])]
        }
    };
}
