/* Alur 1: login & logout */

const formLogin = {
    view: "form", id: "formLogin", width: 360, borderless: false,
    elementsConfig: { labelWidth: 90 },
    elements: [
        { view: "label", label: "Login WMS Warehouse", css: "webix_header" },
        { view: "text", name: "username", label: "Username", required: true },
        { view: "text", name: "password", label: "Password", type: "password", required: true },
        { view: "button", value: "Login", css: "webix_primary", hotkey: "enter", click: prosesLogin }
    ]
};

function hancurkanRoot() {
    ["win_detail"].forEach(id => { if ($$(id)) $$(id).close(); });
    if ($$("root")) $$("root").destructor();
}

function tampilkanLogin() {
    hancurkanRoot();
    webix.ui({ id: "root", rows: [{}, { cols: [{}, formLogin, {}] }, {}] });
}

function prosesLogin() {
    const f = $$("formLogin");
    if (!f.validate()) { webix.message({ type: "error", text: "Username dan password wajib diisi" }); return; }
    panggilApi("POST", "/api/auth/login", f.getValues()).then(res => mulaiAplikasi(res.user));
}

function prosesLogout() {
    panggilApi("POST", "/api/auth/logout", {}).then(() => { userAktif = null; tampilkanLogin(); });
}
