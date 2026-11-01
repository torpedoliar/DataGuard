<div align="center">

# DataGuard (DC-Check)

[English](README.md) · **Bahasa Indonesia**

**Audit data center multi-situs, dokumentasi infrastruktur, SIEM, dan bukti ISO/IEC 27001 dalam satu aplikasi web.**

[![Next.js](https://img.shields.io/badge/Next.js-16.1-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Three.js](https://img.shields.io/badge/Three.js-3D%20racks-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

<img src="Screenshoot/mockup-dashboard-dark.png" alt="Dashboard DataGuard" width="880" />

</div>

## Daftar isi

- [Kenapa DataGuard](#kenapa-dataguard)
- [Fitur](#fitur)
- [Tangkapan layar](#tangkapan-layar)
- [Arsitektur](#arsitektur)
- [Teknologi](#teknologi)
- [Memulai](#memulai)
- [Deployment dengan Docker](#deployment-dengan-docker)
- [Konfigurasi](#konfigurasi)
- [Migrasi database](#migrasi-database)
- [Pengujian](#pengujian)
- [Keamanan](#keamanan)
- [Struktur proyek](#struktur-proyek)
- [Lisensi](#lisensi)

## Kenapa DataGuard

Tim data center sering mencatat aset, inspeksi shift, insiden, dan bukti kepatuhan di spreadsheet, grup chat, dan logbook kertas yang terpisah-pisah. Akibatnya ada celah saat serah terima shift dan banyak pekerjaan manual menjelang setiap audit. DataGuard menyimpan catatan fisik dan teknis setiap situs di satu tempat: perangkat apa terpasang di mana, bagaimana kabelnya, apa hasil inspeksi terakhir, insiden mana yang masih terbuka, serta ancaman dan kerentanan apa saja yang sudah dinilai.

Setiap situs terisolasi, pengguna hanya bisa melihat situs yang ditugaskan kepadanya, dan antarmuka tersedia dalam bahasa Inggris dan Indonesia.

## Fitur

### Operasional harian

- Checklist per shift (`Pagi`, `Siang`, `Malam`) dengan status `OK`, `Warning`, dan `Error`, bukti foto, serta pemindaian QR langsung di browser untuk mengenali perangkat.
- Grid audit 7 hari yang menampilkan kondisi setiap rack dan perangkat per hari.
- Insiden dibuat otomatis dari warning dan error checklist, lengkap dengan tenggat, triase, kategori penyelesaian, verifikasi foto, dan notifikasi bila terlambat.
- Tautan koneksi cepat (HTTP, HTTPS, SSH, Telnet) di halaman perangkat.

### Dokumentasi infrastruktur

- Penyusun layout rack dengan drag and drop (`@dnd-kit`), pengecekan tabrakan U-height, zona, dan pembacaan suhu ruangan.
- Tampilan rack dan ruangan 3D (Three.js dengan React Three Fiber): faceplate perangkat, port berkedip, jalur kabel, hologram untuk perangkat peer di ruangan yang sama, dan kartu rack untuk peer di ruangan lain.
- Editor layout ruangan yang juga menempatkan unit PAC (precision air conditioning) dan model UPS.
- Profil perangkat dengan pratinjau lokasi 2D dan 3D.
- Dokumentasi jaringan: kecepatan port, jenis media (`Copper`, `Fiber`, `DAC`), mode port (`Access`, `Trunk`, `Routed`, `LACP`), penetapan VLAN, cross-connect antar port, dan faceplate switch serta patch panel yang interaktif.
- Integrasi dengan NCM v4 (network configuration manager): sinkronisasi perangkat, pengecekan heartbeat, dan API ingest.

### SIEM

- Penerima syslog di UDP 514, TCP 1515, dan TLS 6514.
- Worker parser yang menormalkan pesan RFC 5424 dan RFC 3164, dengan parser vendor untuk MikroTik, Cisco, Fortigate, dan Linux.
- Mesin aturan dengan rule anomali, ambang batas, dan urutan, dashboard findings, serta daftar IOC.
- Alert melalui Telegram dan email.
- Triase findings dengan AI secara opsional melalui endpoint OpenAI-compatible.
- Aksi respons yang dijalankan sebagai webhook hanya setelah disetujui (aturan dua orang).
- Snapshot per jam untuk riwayat tren dan retensi otomatis untuk event lama.

### Bukti ISO/IEC 27001:2022

- Register threat intelligence untuk kontrol A.5.7 dan register kerentanan teknis untuk kontrol A.8.8.
- Skor CVSS v3.1, keterkaitan dengan aset perangkat keras dan lunak (termasuk VM), lampiran bukti ganda, serta siklus status dari Open, In Progress, hingga Mitigated.
- PDF audit (A4 landscape berisi ringkasan eksekutif, matriks KPI, buku mitigasi, dan tiga kolom tanda tangan: disiapkan, ditinjau, disetujui) serta workbook Excel audit.

### Administrasi

- Situs, lokasi, merek, kategori, grup perangkat, pengguna, dan peran (`Superadmin`, `Admin`, `Staff`).
- Email laporan terjadwal harian, mingguan, dan bulanan.
- Backup dan restore untuk superadmin: file ZIP berisi dump PostgreSQL format custom dan file unggahan, dipulihkan dengan mode hapus-lalu-pulihkan atau tambahkan. Scheduler backup menyimpan salinan harian, mingguan, dan bulanan.
- Audit log untuk setiap perubahan penting, ditambah log email.

## Tangkapan layar

| Dashboard operasional | Layout rack |
|:---:|:---:|
| ![Dashboard](Screenshoot/1.jpg) | ![Layout rack](Screenshoot/2.jpg) |

| Findings SIEM | Grid audit 7 hari |
|:---:|:---:|
| ![Findings SIEM](Screenshoot/3.jpg) | ![Grid audit](Screenshoot/4.jpg) |

## Arsitektur

```mermaid
flowchart TB
    subgraph Klien
        Browser["Browser (Next.js 16 + React 19)"]
        Scanner["Pemindai QR kamera ponsel"]
        Sources["Perangkat jaringan dan server (syslog)"]
        NCM["NCM v4"]
    end

    subgraph App["Container aplikasi (dccheck_app, port 3001)"]
        Router["App Router dan server actions"]
        Auth["Sesi dan RBAC (JWT jose)"]
        Export["Ekspor PDF dan Excel"]
        Upload["Pipeline unggah dengan cek magic byte"]
    end

    subgraph Workers["Worker latar belakang"]
        Syslog["Penerima syslog"]
        Parser["Parser"]
        Rules["Mesin aturan"]
        Alerts["Alert (Telegram, SMTP)"]
        AI["Triase AI"]
        Response["Aksi respons"]
        Retention["Retensi dan snapshot"]
        Ops["Insiden terlambat, backup, sinkron network-doc"]
    end

    DB[("PostgreSQL 15 (Drizzle ORM)")]
    Files[("Volume unggahan dan backup")]

    Browser --> Auth --> Router
    Scanner --> Auth
    Router --> Export
    Router --> Upload --> Files
    Router --> DB
    NCM <--> Router
    Sources --> Syslog --> DB
    Parser <--> DB
    Rules <--> DB
    Rules --> Alerts
    AI <--> DB
    Response <--> DB
    Retention <--> DB
    Ops <--> DB
```

## Teknologi

| Area | Teknologi |
|---|---|
| Frontend | Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4, ikon Lucide, next-intl |
| 3D | three, @react-three/fiber |
| Backend dan data | Server actions, Drizzle ORM, PostgreSQL lewat `pg` |
| Autentikasi | Sesi JWT stateless dengan `jose`, `bcryptjs` |
| Interaksi | `@dnd-kit/core`, `@dnd-kit/sortable` |
| Laporan | `jspdf`, `jspdf-autotable`, `xlsx` |
| QR | `qrcode`, `html5-qrcode` |
| Kualitas | Vitest, TypeScript strict mode, ESLint 9 |

## Memulai

Prasyarat: Node.js 20 atau lebih baru dan PostgreSQL 15 atau lebih baru.

```bash
git clone https://github.com/torpedoliar/DataGuard.git
cd DataGuard
npm install
```

Buat file `.env`:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/dccheck"
SESSION_SECRET="minimal 32 karakter, misalnya dari: openssl rand -base64 32"
AI_KEY_ENCRYPTION_SECRET="secret acak panjang lainnya"
```

Lalu siapkan database dan jalankan dev server:

```bash
npm run db:migrate     # terapkan migrasi dari drizzle/
npm run seed           # data dasar dan admin default
npm run dev            # http://localhost:3000
```

Seed membuat pengguna `admin` dengan password `password`. Segera ganti setelah login pertama.

## Deployment dengan Docker

```bash
cp .env.example.production .env    # isi DB_*, SESSION_SECRET, AI_KEY_ENCRYPTION_SECRET
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

Di server Linux baru, `./deploy.sh` menyalakan stack secara berurutan (database, lalu aplikasi dengan sinkronisasi skema dan seed, lalu para worker) dan aman dijalankan ulang. Di Windows, gunakan `start.bat` atau `start-podman.bat` untuk menyalakan dan `update.ps1` atau `update.bat` untuk memperbarui. Skrip update tidak pernah menjalankan `down -v`, tidak pernah me-rebuild atau menghentikan container database, dan berhenti bila backup database gagal. [DEPLOYMENT_CONTAINER.md](DEPLOYMENT_CONTAINER.md) menjelaskan cara menyalakan Docker otomatis setelah Windows Server restart.

| Service | Container | Port host | Fungsi |
|---|---|:---:|---|
| `app` | `dccheck_app` | 3001 | Web server Next.js |
| `db` | `dccheck_postgres` | 3002 | PostgreSQL |
| `syslog-receiver` | `dccheck_syslog_receiver` | 514/udp, 1515/tcp, 6514/tcp | Penerimaan syslog (biasa dan TLS) |
| `siem-parser` | `dccheck_siem_parser` | | Normalisasi dan parsing |
| `siem-rules` | `dccheck_siem_rules` | | Aturan deteksi dan korelasi |
| `siem-alerts` | `dccheck_siem_alerts` | | Alert Telegram dan email |
| `siem-ai` | `dccheck_siem_ai` | | Triase findings dengan AI |
| `siem-retention` | `dccheck_siem_retention` | | Retensi event |
| `siem-snapshot` | `dccheck_siem_snapshot` | | Snapshot tren per jam |
| `siem-response` | `dccheck_siem_response` | | Aksi respons yang sudah disetujui |
| `incidents-overdue-notify` | `dccheck_incidents_overdue_notify` | | Pengingat insiden terlambat |
| `backup-scheduler` | `dccheck_backup_scheduler` | | Backup terjadwal |
| `network-doc-sync` | `dccheck_network_doc_sync` | | Sinkronisasi dokumentasi jaringan per situs setiap jam |

Port syslog TCP dan TLS bisa diubah dengan `SYSLOG_TCP_PORT` dan `SYSLOG_TLS_PORT`.

## Konfigurasi

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL`, atau `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | ya | Koneksi PostgreSQL |
| `SESSION_SECRET` | ya | Secret penandatangan sesi, minimal 32 karakter |
| `AI_KEY_ENCRYPTION_SECRET` | ya | Mengenkripsi key provider AI yang disimpan. Compose menolak start tanpanya |
| `SECURE_COOKIES` | tidak | Memaksa cookie secure di belakang HTTPS |
| `NEXT_PUBLIC_APP_URL`, `DG_PUBLIC_URL` | tidak | URL publik untuk tautan dan email |
| `SMTP_URL`, `SMTP_FROM` | tidak | Email keluar |
| `NCM_URL`, `NCM_KEY` | tidak | Koneksi ke NCM v4 |
| `SIEM_AI_ENDPOINT_URL`, `SIEM_AI_API_KEY`, `SIEM_AI_DEFAULT_MODEL` | tidak | Provider triase AI |
| `BACKUP_DIR`, `BACKUP_SCHEDULE_HOURS`, `BACKUP_RETENTION_DAILY`, `_WEEKLY`, `_MONTHLY` | tidak | Jadwal dan retensi backup |
| `PURGE_RETENTION_DAYS` | tidak | Retensi event SIEM |

Setiap worker juga menerima variabel interval polling, misalnya `SIEM_PARSER_POLL_INTERVAL_MS`.

## Migrasi database

Perubahan skema ditulis manual sebagai file SQL di `drizzle/` beserta entri di `drizzle/meta/_journal.json`, lalu diterapkan dengan `npm run db:migrate`. Jangan jalankan `drizzle-kit generate` atau `push`: rantai snapshot di `drizzle/meta/` berhenti di migrasi 0023, sehingga migrasi hasil generate akan mencoba membuat ulang tabel dan kolom yang sudah ada. Detailnya ada di [AGENTS.md](AGENTS.md).

## Pengujian

```bash
npm run test         # suite Vitest
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run check        # lint + test + build
```

Test diletakkan di samping kode yang diujinya sebagai `*.test.ts` dan `*.test.tsx`.

## Keamanan

- Pastikan `SESSION_SECRET` minimal 32 karakter dan jangan pernah commit `.env` atau secret produksi.
- File unggahan diperiksa berdasarkan ekstensi, tipe MIME, dan magic byte di `lib/upload.ts`.
- Perubahan penting (pengguna, rack, threat intel, backup) ditulis ke tabel `audit_logs`.
- Aksi respons hanya berjalan setelah disetujui orang kedua, dan secret-nya tidak ditulis ke log.
- Laporkan kerentanan sesuai panduan di [SECURITY.md](SECURITY.md).

## Struktur proyek

```
app/[locale]/        halaman terlokalisasi: login, pilih situs, dashboard, checklist, grid, compliance, report, admin
app/api/             health, metrics, cron, uploads, endpoint NCM
actions/             server actions (mutasi dan query)
components/          UI per fitur, UI bersama di components/ui
db/                  skema dan koneksi Drizzle
drizzle/             migrasi SQL yang ditulis manual
lib/                 logika domain, unggahan, sesi, SIEM, laporan
scripts/             entry point migrate, seed, dan worker
messages/            terjemahan en.json dan id.json
```

Panduan kontribusi ada di [CONTRIBUTING.md](CONTRIBUTING.md) dan [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Lisensi

Dirilis di bawah [Lisensi MIT](LICENSE).

Dikembangkan oleh Yohanes Octavian Rizky ([@torpedoliar](https://github.com/torpedoliar)).
