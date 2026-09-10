# Runbook: Integrasi DataGuard ↔ NCM (fitur `ncm-manage`)

> Panduan operasional untuk menghubungkan satu site NCM ke DataGuard sentral,
> dari nol sampai dashboard `/admin/ncm` hidup. Spesifikasi lengkap:
> `.scratch/ncm-manage/SPEC.md` di masing-masing repo.

## 0. Prasyarat

- **VPN antar-site aktif**: DataGuard (sentral) HARUS bisa menjangkau NCM per
  site lewat HTTP (`http://<host-ncm>:8443`). Tidak ada TLS di sisi NCM —
  keamanan transport diserahkan ke VPN. Uji dulu: `curl http://<ncm>/api/v1/network-doc`
  dari mesin DG harus menjawab 401 (bukan connection refused).
- NCM v4 berjalan (desktop app atau service) dengan akun admin.
- DataGuard berjalan dengan akses superadmin.

## 1. Buat API key di NCM (sekali per site)

Login sebagai admin NCM → **API Keys** → buat key dengan scope:

| Scope | Dipakai untuk |
|---|---|
| `read` | Status fleet, jadwal, baseline, review, rollback script |
| `switches:write` | Tambah/edit/hapus/aktif-nonaktifkan switch |
| `credentials:write` | Set/rotasi password switch (pass-through, tanpa read-back) |
| `schedules:write` | Kelola jadwal backup |
| `baselines:write` | Buat/refresh/hapus baseline |
| `backup:write` | Trigger backup on-demand |
| `reviews:write` | Approve/flag review drift dari DG |
| `system:write` | Push konfigurasi webhook ke NCM dari UI DG (langkah 3) |

Simpan plaintext key sekali — NCM hanya menyimpan hash. Key tanpa scope
(legacy) tetap berfungsi untuk integrasi network-doc lama.

## 2. Daftarkan koneksi di DataGuard

Login superadmin DG → **Admin → Settings → NCM** (per site):
1. Isi **URL** NCM site (`http://<host>:8443`).
2. Tempel **API key** dari langkah 1 — buat dengan scope lengkap di tabel
   langkah 1 (tersimpan terenkripsi AES-256-GCM). Scope `system:write`
   dipakai DG untuk me-push konfigurasi webhook ke NCM (langkah 3).
3. Klik **Test connection** — hijau berarti roundtrip sukses dan
   `lastSeenAt` heartbeat terisi.

## 3. Webhook NCM → DG (event → incident) — semua lewat UI

1. Di DG: buka **Admin → Settings → NCM**, lalu di kartu site isi
   **URL Webhook** dengan `https://<dg>/api/ncm/ingest` dan **Webhook Secret**
   (tersimpan terenkripsi AES-256-GCM, sama seperti admin API key).
2. Klik **Simpan & Push ke NCM** — DG menyimpan konfigurasi dan langsung
   me-push `webhook_url` + `webhook_secret` ke NCM
   (`PATCH /api/v1/system/notify-settings` dengan admin API key site,
   scope `system:write`). Badge berubah menjadi "Webhook terkonfigurasi".
3. Event yang terkirim: `backup_failed`, `backup_ok`, `drift`,
   `review_opened`, `review_decided`, `device_offline`.
4. Verifikasi HMAC: setiap request membawa header
   `X-NCM-Signature: sha256=<hmac-sha256(secret, body)>`.
   Mismatch → DG menolak 401.

## 4. Migrasi database DataGuard

Fitur ini butuh migrasi `0057` (ncm_settings), `0058` (webhook_secret),
dan `0059` (webhook_url). Jalankan `npm run db:migrate` saat deploy. Tanpa
itu, halaman NCM akan gagal membaca konfigurasi.

## 5. Operasional harian (dashboard `/admin/ncm`)

- **Switches**: CRUD switch; password hanya bisa diset, tidak pernah
  ditampilkan kembali.
- **Backups & Schedules**: trigger backup manual, ubah jadwal.
- **Baselines & Reviews**: snapshot golden config; review drift masuk
  antrian → approve/flag (tercatat di audit NCM dan DG).
- **Connection** (superadmin): URL + key + test-connection; webhook push
  (URL + secret langsung terkirim ke NCM, badge status per site).
- **Offline**: bila NCM tak terjangkau, banner merah "NCM offline" muncul
  dan semua aksi dinonaktifkan — perintah tidak diantrekan; coba lagi
  setelah koneksi pulih.

## 6. Troubleshooting

| Gejala | Sebab umum | Tindakan |
|---|---|---|
| Banner offline padahal NCM hidup | VPN turun / URL salah | `curl` dari host DG ke NCM; perbaiki URL di Connection |
| `NCM API responded 403` | Key tanpa scope yang dibutuhkan | Buat key baru dengan scope lengkap (tabel langkah 1) |
| `NCM API responded 401` | Key di-revoke / salah tempel | Buat ulang key, update di Connection |
| Incident tidak muncul | Webhook beda / push gagal | Buka NCM → Settings → NCM: badge per site menunjukkan status; klik Simpan & Push ke NCM ulang; cek log ingest (401 = signature) |
| Incident dobel | — | Tidak mungkin: dedupe by NCM event ID |
| Test connection hijau tapi aksi gagal | Scope key kurang untuk aksi tulis | Tambah scope sesuai tabel |
