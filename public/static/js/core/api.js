/* Core: pemanggil REST API */

function panggilApi(method, url, data) {
    const req = webix.ajax().headers({ "Content-Type": "application/json" });
    const body = data === undefined ? undefined : JSON.stringify(data);
    const p = method === "GET" ? req.get(url)
        : method === "DELETE" ? req.del(url)
        : method === "PUT" ? req.put(url, body)
        : req.post(url, body);
    return p.then(res => res.json()).catch(err => {
        let pesan = "Terjadi kesalahan pada server";
        try { pesan = JSON.parse(err.responseText).error || pesan; } catch (e) { /* abaikan */ }
        if (err && err.status === 401 && !url.includes("/auth/")) {
            webix.message({ type: "error", text: "Sesi berakhir, silakan login ulang", expire: 3000 });
            setTimeout(() => location.reload(), 1200);
        } else {
            webix.message({ type: "error", text: pesan, expire: 5000 });
        }
        throw new Error(pesan);
    });
}
