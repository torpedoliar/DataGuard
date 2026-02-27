# 🐳 Panduan Deploy DC-Check Menggunakan Container

Panduan ini berisi langkah-langkah untuk melakukan *deployment* (atau *local development*) aplikasi **DC-Check** beserta database PostgreSQL menggunakan **Docker** atau **Podman**.

Arsitektur yang digunakan adalah **Full Containerized Architecture**:
1. Service Web `app` (Next.js Standalone).
2. Service Database `db` (PostgreSQL 15 Alpine).

Semuanya dikoordinasikan secara otomatis oleh file `docker-compose.yml`.

---

## 📋 Prasyarat

Sebelum memulai, pastikan server/komputer Anda sudah menginstal salah satu dari perangkat lunak berikut:
- **Docker** dan **Docker Compose**
- *atau* **Podman** dan **Podman Compose** (disarankan bagi pengguna Red Hat/Fedora/Rocky Linux)

---

## 🚀 Langkah-langkah Deployment

### 1. Build dan Nyalakan Kontainer

Buka terminal di dalam folder utama project ini, lalu jalankan perintah penyalaan kontainer:

**Jika menggunakan Docker:**
```bash
docker-compose up -d --build
```

**Jika menggunakan Podman:**
```bash
podman-compose up -d --build
```
> Parameter `-d` berarti menjalankan dalam mode *detached* (berjalan di *background*).
> Parameter `--build` memastikan Next.js di-compile ulanng menjadi image lokal jika ada perubahan kode.

Tunggu beberapa saat hingga status kedua servis menjadi `Started`/`Running`. Aplikasi sekarang sudah berjalan dan dapat diakses melalui `http://localhost:3001`.

### ⚠️ Khusus Podman di Windows — Akses via IP Server

> **Perbedaan penting Podman vs Docker di Windows:**
> Podman berjalan di dalam VM (WSL2), sehingga port forwarding **hanya di-map ke IP dinamis internal WSL**. Artinya, Anda bisa mengakses `http://localhost:3001` dari server itu sendiri, tapi **TIDAK bisa** dari komputer lain via IP server, karena portproxy Windows perlu diarahkan ke IP virtual WSL tersebut.
>
> Docker Desktop tidak memiliki masalah ini karena memiliki network driver terintegrasi yang otomatis binding ke semua interface.

**Solusi Otomatis:**
Kami telah menyediakan script PowerShell untuk secara dinamis mendeteksi IP WSL terbaru dan menghubungkannya ke Windows Server.

Jalankan perintah ini di **PowerShell Administrator** pada server Anda:

```powershell
# Jalankan script ini untuk langsung mengaktifkan port proxy:
.\scripts\setup-portproxy.ps1

# JALANKAN INI AGAR SCRIPT BERJALAN OTOMATIS SETIAP KALI SERVER RESTART:
.\scripts\setup-portproxy.ps1 -InstallTask
```

> **Catatan:** IP virtual dari WSL2 berubah setiap kali Windows/WSL di-restart. Dengan parameter `-InstallTask`, Windows akan otomatis menjalankan script pencari IP ini secara sembunyi-sembunyi saat server menyala, sehingga Anda tidak perlu repot lagi!


> ```

Setelah itu, aplikasi bisa diakses dari komputer lain via `http://IP_SERVER:3001`.

### 2. Migrasi Skema Database (Wajib untuk pertama kali)

Walaupun kontainer sudah nyala, tabel-tabel di dalam database PostgreSQL saat ini masih kosong. 

Anda perlu mengeksekusi sinkronisasi skema (`db:push`) ke dalam kontainer Next.js (`dccheck_app`):

**Untuk Docker:**
```bash
docker exec -it dccheck_app npm run db:push
```

**Untuk Podman:**
```bash
podman exec -it dccheck_app npm run db:push
```
Jika diminta konfirmasi, tekan `y` lalu `Enter`.

### 3. Eksekusi Data Awal (Seed Data)

Agar Anda bisa masuk ke aplikasi, Anda harus memasukkan data awal seperti akun Admin dan Lokasi Demo. 

Jalankan perintah ini untuk memasukkan *seed data*:

**Untuk Docker:**
```bash
docker exec -it dccheck_app npm run seed:users
```

**Untuk Podman:**
```bash
podman exec -it dccheck_app npm run seed:users
```

**Berhasil!** Sekarang Anda dapat membuka `http://localhost:3001` di browser dan masuk menggunakan:
- **Username:** `admin` (superadmin)
- **Password:** `password`

---

## 🛠️ Manajemen Kontainer Lanjutan

### Melihat Log Aplikasi Berjalan

Untuk melihat baris-log yang dihasilkan oleh *web server* Next.js secara *real-time*:

**Docker:** `docker logs -f dccheck_app`
**Podman:** `podman logs -f dccheck_app`

### Mematikan / Menghentikan Servis

Jika ingin memberhentikan kontainer sementara tanpa menghapus datanya:
```bash
docker-compose stop
# atau podman-compose stop
```

Jika Anda ingin **mematikan total** beserta jaringan interkoneksi (*Network Bridge*) nya (Volume / Data TIDAK akan terhapus):
```bash
docker-compose down
# atau podman-compose down
```

### Mengakses Basis Data via Klien Eksternal

Meskipun PostgreSQL berjalan di dalam kontainer tertutup, pada `docker-compose.yml` kami sudah mengekspos port ke `3002` mesin *host* dengan binding `0.0.0.0` (Wildcard) agar bisa diakses dari perangkat mana saja yang terhubung ke jaringan server ini, bukan hanya dari `localhost`.

> **Catatan Penting:** Jika binding port di `docker-compose.yml` hanya ditulis `"3001:3001"` (tanpa prefix `0.0.0.0:`), maka aplikasi **hanya bisa diakses dari `localhost`** dan tidak bisa diakses menggunakan IP server dari komputer lain. Pastikan format binding adalah `"0.0.0.0:PORT_HOST:PORT_CONTAINER"`.

Anda bisa membuka aplikasi seperti **DBeaver**, **TablePlus**, atau **pgAdmin** dengan koneksi:
- **Host:** `localhost` atau IP Server
- **Port:** `3002`
- **Database:** `dccheck`
- **Username:** `administrator`
- **Password:** `Arabika1927`

### Menghapus Bersih Database (Kehilangan Data Permanen!)

Volume bernama `dccheck_pgdata` dan `dccheck_uploads` dirancang untuk persisten dan tidak akan hancur meski perintah `down` dipanggil.

Jika suatu saat Anda benar-benar inign mereset semua dari nol, jalankan:
```bash
# PERINGATAN! Ini akan menghapus data permanen
docker-compose down -v
# atau
podman-compose down -v
```

### Mengganti Password Database

Jika Anda ingin mengganti password database PostgreSQL, Anda **wajib mengubah di 3 file** agar tetap konsisten:

**1. `.env`** (untuk development lokal tanpa container)
```
DB_PASSWORD=PASSWORD_BARU
```

**2. `docker-compose.yml`** (untuk deployment container)
```yaml
# Di service 'app' → environment
DB_PASSWORD: PASSWORD_BARU

# Di service 'db' → environment
POSTGRES_PASSWORD: PASSWORD_BARU
```

**3. `Dockerfile`** (default fallback di image)
```dockerfile
ENV DB_PASSWORD="PASSWORD_BARU"
```

> ⚠️ **PENTING:** PostgreSQL hanya membuat user & password saat **inisialisasi pertama** volume. Jika Anda sudah pernah menjalankan container dengan password lama, Anda **harus menghapus volume data lama** terlebih dahulu agar password baru berlaku:
> ```bash
> docker-compose down -v   # atau podman-compose down -v
> docker-compose up -d     # buat ulang dari awal
> ```
> Setelah itu, jalankan kembali `db:push` dan `seed:users` seperti pada langkah awal.

### ⚠️ Peringatan Pembaruan Skema Database (OTA / Manual)

Ketika Anda melakukan update menggunakan skrip pembaruan OTA (`update.sh` / `update.ps1`) atau secara manual memanggil `db:push`, harap perhatikan hal-hal berikut terkait keutuhan data:

**✅ AMAN (Additive Changes - Data Lama Tetap Aman):**
- Menambahkan **kolom baru** (terutama dengan nilai *default* bersamanya).
- Menambahkan **tabel baru** atau index pencarian.

**❌ BERPOTENSI BERBAHAYA (Destructive Changes - Data Bisa Hilang):**
- **Menghapus kolom**. Data di dalamnya akan hilang permanen.
- **Mengubah nama kolom** (`name` -> `fullName`). Drizzle Kit menganggap Anda melakukan DROP kolom `name` lalu CREATE kolom baru `fullName`, sehingga semua nama akan reset/hilang kecuali dimigrasi khusus.
- **Mengubah jenis tipe data**.
- **Menghapus tabel keseluruhan**.

> Skrip otomatis (OTA) sudah dilengkapi proteksi *Zero-Downtime Backup* yaitu memaksa me-*backup database penuh* (<1 Detik) sebelum menarik pembaruan GitHub. Namun untuk perubahan yang bersifat "Destructive", sangat disarankan untuk melakukan *push skema* secara manual di server (tanpa flag `-T`) agar promp *warning* terkait penghapusan dapat dikonfirmasi terlebih dahulu.

---

*Disusun oleh Antigravity (Sistem Operasional v4.0)*
