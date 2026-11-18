/* Entry point: cek sesi lalu mulai aplikasi */

panggilApi("GET", "/api/auth/me").then(res => res.user ? mulaiAplikasi(res.user) : tampilkanLogin());
