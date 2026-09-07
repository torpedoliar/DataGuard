# Panduan Operator: Coverage Matrix & Top Sources

> Tanggal: 2026-09-05 · Untuk: operator/admin DataGuard SIEM
> Dua temuan dari review fitur baru (MITRE ATT&CK & ISO 27001 Coverage, Top Sources 24h).

---

## 1. Di Mana Pengaturan "MITRE ATT&CK & ISO 27001 Coverage" dan "Top Sources (24h)"?

Keduanya **bukan halaman terpisah** — keduanya panel di dashboard SIEM:

```
Admin › SIEM   (dashboard utama)
├── Statistik ringkas (raw 24h, findings, alerts, dst.)
├── Time-Series Trends (24h / 7d / 30d)
├── Top Sources (24h)          ← panel tabel sumber paling berisik
├── Latest Findings            ← tabel temuan terbaru
└── MITRE ATT&CK & ISO 27001 Coverage   ← panel matriks coverage (paling bawah)
```

URL langsung: `/admin/siem`

### 1.1 Membaca Panel Coverage

- **Kotak hijau** = ada rule **aktif** yang mendeteksi tactic/kontrol tersebut. Angka di dalam kotak = jumlah rule aktif.
- **Kotak abu-abu** = tidak ada rule aktif (belum dipetakan, atau rule-nya dimatikan).
- Baris atas = 14 tactics MITRE ATT&CK Enterprise (urutan kill-chain: Reconnaissance → Impact).
- Baris bawah = kontrol ISO 27001 Annex A yang dipetakan (mis. A.8.15 Logging, A.8.16 Monitoring).
- Statistik di kanan atas panel: `X/14 tactics · Y/Z rules mapped & enabled`.

> Pemakaian utama: **audit ISO 27001**. Saat auditor menanyakan "bagaimana Anda memonitor A.8.16?", panel ini adalah jawaban visualnya — dan sekaligus menunjukkan tactics mana yang belum ter-cover deteksinya.

### 1.2 Mengubah Pemetaan MITRE / ISO per Rule

Pemetaan diatur **per rule** di halaman Rules:

1. Buka **Admin › SIEM › Rules** (`/admin/siem/rules`).
2. Klik tombol **Edit** pada rule yang dimaksud.
3. Di modal Edit, isi tiga field baru:
   | Field | Format | Contoh |
   | :--- | :--- | :--- |
   | **MITRE Tactics** | nama tactic, dipisah koma | `Credential Access, Discovery` |
   | **MITRE Techniques** | ID teknik MITRE, dipisah koma | `T1110, T1110.001` |
   | **ISO 27001 Controls** | ID kontrol Annex A, dipisah koma | `A.8.15, A.8.16` |
4. Simpan. Matriks coverage di dashboard langsung mengikuti.

Catatan:
- Kosongkan field untuk melepas pemetaan.
- Rule yang **dimatikan** (uncheck "Aktif") tetap terhitung sebagai "mapped" tapi **tidak** menghitung sebagai "covered" (kotak kembali abu-abu) — matriks selalu mencerminkan yang benar-benar mendeteksi saat ini.
- 28 default rules sudah ter-tag otomatis (mis. `auth.failed_login_spike` → T1110 Brute Force + A.8.16). Rule buatan sendiri perlu di-tag manual bila ingin ikut terhitung.

---

## 2. Kenapa "Top Sources (24h)" Menampilkan "Unmapped" Padahal Device-nya Ada di Inventory?

### 2.1 Akar Masalah: Dua Sumber Data yang Berbeda

| Halaman | Sumber data | Kapan di-stamp |
| :--- | :--- | :--- |
| **Top Sources** (dashboard) | kolom `source_id` pada baris `syslog_events` | **saat event masuk** — oleh parser worker |
| **Admin › SIEM › Sources** | tabel registry `syslog_sources` | **mapping yang Anda kelola sekarang** |

Kolom `source_id` pada event bersifat **beku (immutable)**: event yang sudah masuk **tidak** di-stamp ulang ketika Anda mengubah mapping hari ini. Jadi "Unmapped" di Top Sources hampir selalu berarti *event itu masuk sebelum mapping/device-nya ada* — bukan berarti device-nya tidak ada di inventory.

### 2.2 Urutan Matching Parser (untuk event baru)

Parser mencocokkan setiap paket syslog masuk dengan urutan ini (`lib/siem/source-enrichment.ts`):

1. **`syslog_sources.source_ip`** — registry SIEM (hasil mapping manual Anda) → match terbaik.
2. **`devices.ip_address`** — inventory, cocokkan by IP (+ site harus sama).
3. **hostname → `syslog_sources.hostname`**
4. **hostname → `devices.name`**
5. Tidak ada yang cocok → event **didrop** (tidak masuk dashboard sama sekali).

### 2.3 Penyebab "Unmapped" yang Paling Umum

| # | Penyebab | Ciri-ciri |
| :--- | :--- | :--- |
| 1 | **Event lama dicatat sebelum mapping/device dibuat** | "Unmapped" hanya di window 24h setelah onboarding device; event baru setelah mapping sudah berlabel benar |
| 2 | **Device di site lain** | Matching by IP mewajibkan site sama; cek site device di inventory vs site aktif Anda |
| 3 | **IP sumber berbeda dari IP device** (NAT/gateway) | Syslog datang dari IP gateway firewall, bukan IP asli device — cek `devices.ipAddress` vs kolom IP di tabel Top Sources |
| 4 | **Device belum punya baris di `syslog_sources`** dan fallback by IP tidak kena (IP beda format/whitespace) | Halaman Sources tidak menampilkan device tersebut |

### 2.4 Cara Memperbaiki (yang benar)

1. Buka **Admin › SIEM › Sources** (`/admin/siem/sources`).
2. Source yang belum dipetakan akan terlihat di tabel (kolom Device kosong / "Unmapped device").
3. Klik **Edit** pada baris source tersebut → pilih **Device** dari dropdown (daftar dari inventory per-site) → atur vendor & parser profile → simpan.
4. Mulai detik itu, **semua event berikutnya** dari IP tersebut otomatis ter-stamp device yang benar — termasuk di Top Sources.

> Mapping via halaman Sources **lebih baik** daripada hanya mengandalkan fallback by IP dari inventory: registry menyimpan vendor + parser profile (mikrotik/cisco/fortigate/dst.), sehingga normalisasi event jauh lebih akurat.

### 2.5 Keterbatasan yang Diketahui (dan Rencana Opsional)

- **Event historis tidak di-remap otomatis** setelah mapping dibuat. Ini by design (event adalah audit trail; mengubahnya diam-diam berbahaya untuk integritas log).
- Opsi penyelesaian backlog: tombol **"Re-stamp events"** di halaman Sources — menjalankan `UPDATE syslog_events SET source_id/device_id` berdasarkan mapping registry untuk event 24–48 jam terakhir, sehingga Top Sources langsung menampilkan nama device untuk event yang lalu. Fitur ini **belum dibuat**; minta developer jika diperlukan.

---

## Lampiran: Referensi Cepat

| Keperluan | Lokasi |
| :--- | :--- |
| Lihat coverage MITRE/ISO | `/admin/siem` (panel bawah) |
| Edit pemetaan rule | `/admin/siem/rules` → Edit |
| Mapping source → device | `/admin/siem/sources` → Edit |
| Kelola IOC watchlist | `/admin/siem/iocs` |
| Approval aksi respons (SOAR) | `/admin/siem/findings` → Respons → Approve |
| Dokumen gap analysis enterprise | `docs/research/enterprise-siem-capabilities.md` |
