# WatchGuard EPDR Integration Design

Status: **Spesifikasi ditinjau ulang; belum diimplementasikan.**
Tanggal dokumen/filename adalah label perencanaan, bukan bukti tanggal uji live.

Audit permintaan: [REQUIREMENTS.md](../plans/2026-11-09-watchguard-epdr/REQUIREMENTS.md). Kontrak lintas tiket: [CONTRACTS.md](../plans/2026-11-09-watchguard-epdr/CONTRACTS.md). Keduanya wajib dibaca agent pelaksana. Keputusan pengguna, rekomendasi rekayasa, dan kapabilitas yang terblokir dibedakan di matriks tersebut.

## Batas terbaru: WATCHGUARD READ-ONLY

Instruksi terbaru pengguna: **jangan mengubah apa pun di server WatchGuard**. [READ_ONLY_SAFEGUARD.md](../plans/2026-11-09-watchguard-epdr/READ_ONLY_SAFEGUARD.md) mengesampingkan seluruh rancangan eksekusi live di bawah. Hanya pembacaan terdaftar dan POST token OAuth diperbolehkan di adapter nyata. Scan/repair/reboot/isolasi, perubahan status/komentar dan konfigurasi tetap diblokir; logika diuji dengan mock. Approval maupun pengaturan UI tidak membuka kunci. Pengaman ini baru didokumentasikan; implementasi kode dan tesnya adalah prasyarat T01, belum dikerjakan.

## 1. Tujuan

Menghubungkan dc-check dengan WatchGuard Cloud (Endpoint Security + ThreatSync) per site untuk:

1. Monitoring kesehatan proteksi endpoint dan penanganan otomatis bertahap.
2. Deteksi ancaman (Malware, PUP, Exploit, IOA) yang otomatis masuk ke modul Incident dc-check.
3. Respons otomatis (full system scan) dengan verifikasi hasil dan penutupan terkontrol.
4. Seluruh konfigurasi dilakukan lewat UI, terpisah per site.

## 2. Keputusan yang sudah disepakati

| # | Keputusan |
|---|---|
| D1 | **Setiap site dc-check memiliki akun WatchGuard sendiri** (contoh: Sidoarjo, Surabaya). Relasi koneksi ↔ site adalah 1:1. |
| D2 | **Incident boleh merujuk endpoint EPDR tanpa aset dc-check** (opsi A). Endpoint tidak perlu didaftarkan sebagai aset. |
| D3 | Mode respons hybrid: setiap aturan dapat diatur **Simulasi / Otomatis / Approval**. |
| D4 | Server/aset kritis wajib approval. Endpoint WatchGuard dengan identitas dan site tervalidasi boleh tanpa aset (D2); target belum tervalidasi diblokir sampai dipetakan, bukan langsung dieksekusi setelah approval. Simulasi tetap tanpa tindakan. |
| D5 | Deteksi Malware / PUP / Exploit activity otomatis membuat Incident dan menjalankan **full system scan** pada endpoint terdeteksi. |
| D6 | Permintaan: error/install error/installing/disabled -> repair protection otomatis, lalu repair agent bila tetap error. Status kebutuhan: BLOCKED_UNSUPPORTED pada API publik yang diperiksa; diagnosis dan fallback manual§4.2 bukan pemenuhan repair otomatis. |
| D7 | Integrasi memakai modul **Incident dc-check yang sudah ada**, bukan antrean insiden terpisah. |
| D8 | Semua konfigurasi operasional diatur lewat UI; tahap awal satu site. Bootstrap infrastruktur bukan pengaturan bisnis. Daftar UI lengkap ada di CONTRACTS C8. |
| D9 | Jalur insiden ThreatSync: IOA/Malware/PUP/Virus/Exploit dengan rating7–10. Jalur aktivitas Malware/PUP/Exploit terpisah, tanpa mengarang rating yang tidak tersedia; keduanya memakai full system scan sebagai default. |

## 3. Hasil verifikasi

### 3.1 Uji koneksi langsung (tercatat dalam percakapan, baca saja)

Diuji pada Account ID Subscriber yang diberikan pengguna, region Jepang (`api.jpn.cloud.watchguard.com`). Nama/kepemilikan site tetap dikonfirmasi lewat UI, bukan disimpulkan hanya dari screenshot:

| Pemeriksaan | Hasil |
|---|---|
| OAuth `client_credentials`, scope `api-access` | 200, token berlaku 3600 detik |
| Accounts API — detail akun | 200, tipe akun 2 (Tier-n Subscriber) |
| Endpoint Security — lisensi | 200 |
| Endpoint Security — devices | 200, **613 endpoint** |
| Endpoint Security — protection status | 200, 613 record |
| ThreatSync — incidents | 200 |

Catatan: kredensial API pertama ditolak (401/403); penyebab akhirnya belum dibuktikan. Kredensial pengganti berhasil. Artinya **tes koneksi di UI harus menguji setiap layanan secara terpisah**, bukan hanya autentikasi. Tidak ada tindakan tulis yang diuji. Kredensial yang dibagikan saat pengujian wajib dirotasi sebelum dipakai permanen.

### 3.2 Kontrak API (OpenAPI resmi lengkap)

Sumber: `management-1.5.2.yaml` dan `threatsync-management-1.2.0.yaml`.

**Endpoint Security Management 1.5.2** — base `/rest/endpoint-security/management/api/v1/accounts/{accountId}`

| Method | Path | Kegunaan di dc-check |
|---|---|---|
| GET | `/devices` | Inventaris endpoint (paging `$top/$skip`, cap 3.000) |
| GET | `/devicesprotectionstatus` | Kesehatan proteksi |
| GET | `/unmanageddevices` | Perangkat tanpa agent |
| GET | `/licenses` | Lisensi |
| GET | `/securityeventcounters/{type}` | Ringkasan aktivitas (mask: 1 Malware, 2 PUP, 4 Exploit, …) |
| GET | `/securityevents/{type}/export/{period}` | Event deteksi per endpoint (1 Malware, 2 PUP, 4 Exploit, 6 Virus, 18 IOA, …; period 1 atau 7 hari) |
| GET | `/securityoverview/{period}` | Ringkasan keamanan |
| GET | `/riskassessment/*` | Risiko |
| GET | `/patchavailability`, `/softwareinventory`, `/devices/{id}/hardwareinventory` | Patch, software, BIOS |
| GET | `/managedconfigurations/{type}` | Profil konfigurasi |
| PATCH | `/managedconfigurations/2/{configId}` | Assign endpoint ke profil workstation/server |
| POST | `/immediatescan` | Scan (scope 0 whole computer, 1 critical areas, 2 specified items), mengembalikan `task_id` |
| POST | `/devices/isolation`, `/devices/noisolation` | Isolasi / lepas isolasi |
| POST | `/devices/action` | **Hanya reboot** (`action_type=1`), countdown immediate s.d. 8 jam |
| POST | `/devices/uninstall` | Uninstall proteksi (tidak dipakai) |
| GET | `/tasks`, `/taskdetails/{type}/{taskId}` | Daftar dan detail task |
| GET | `/tasks/{type}/{taskId}/jobs` | Repetisi task |
| GET | `/tasks/{type}/{taskId}/jobs/{jobId}/status` | **Status per endpoint**: 0 Pending, 1 In progress, 2 Succeeded, 3 Failed, 4 Expired, 5 Canceled, 6 Canceling, 7 Timeout; plus `affected_items`, `start_time`, `finish_time` |
| GET | `/tasks/{type}/{taskId}/jobs/{jobId}/results` | Hasil per endpoint, termasuk `malware_info` (kategori, path, jumlah) |

Tipe task: 1 Antimalware scan, 2 Malware disinfection, 6 Patch install, 7 Patch uninstall, 10 IOC search. Hanya tipe 1 yang bisa **dibuat** lewat API (`/immediatescan`); tipe lain hanya bisa dibaca.

**ThreatSync Management 1.2.0** — base `/rest/threatsync/management`

| Method | Path | Kegunaan |
|---|---|---|
| GET | `/v1/{accountId}/incidents`, `/incidents/{id}` | Insiden (category, type, threatScore, severity, status, entities, recommendedActions, remediated) |
| PATCH | `/v1/{accountId}/incidents/{id}` | Status insiden: **hanya `new`, `read`, `closed`** |
| GET/POST/PATCH/DELETE | `/v1/{accountId}/incidents/{id}/comments[/{commentId}]` | Komentar insiden (CRUD lengkap) |
| POST | `/v1/{accountId}/incidents/{id}/actions`, `/v1/{accountId}/actions` | `killProcess`, `quarantineFile`, `isolate`, `unIsolate`, `blockAddress`, `unblockAddress` |
| GET | `.../actions`, `.../actions/{actionId}` | Status tindakan |
| POST | `/v1/transact` | Batch |
| GET | `/v1/{accountId}/incidents/{id}/ai-summary` | Ringkasan AI (advisory) |

### 3.3 Tidak tersedia di API

Tidak ada di OpenAPI resmi, sehingga **tidak boleh dijanjikan sebagai aksi otomatis**:

- **Repair/reinstall protection dan repair/reinstall agent** — hanya status baca (`reinstall_protection_requested`, `reinstall_agent_requested`, `reinstall_*_error`).
- Membuat task disinfection, patch install, IOC search, atau scan terjadwal/berulang.
- Membuat/mengedit isi profil proteksi (hanya assign).
- Remote shell, script, rollback, restore quarantine, webhook/event push.
- Status `inProgress` pada insiden ThreatSync (status itu hanya untuk *action*).

## 4. Modul A — Monitor › Endpoint Security (kesehatan proteksi)

### 4.1 Pemetaan status Console → API

| Console | Field API | Nilai |
|---|---|---|
| Properly protected | `accumulated_protection_status` | 1 Activated |
| Disabled protection | `accumulated_protection_status` | 2 Deactivated |
| Protection with errors | `accumulated_protection_status` | 3 Error |
| Install error | `accumulated_protection_status` | 4 Error installing |
| No license | `accumulated_protection_status` | 5 Without license |
| Installing… | Managed protection tidak punya enum ini; `/unmanageddevices.status=2` berarti Installing pada inventaris unmanaged. Tampilkan terpisah; kesetaraan dengan slice Console belum terverifikasi. Unknown bukan Installing. |
| Outdated protection / knowledge | `protection_engine_update_status=1`, `knowledge_catalog_update_status=1` |
| Pending restart | `protection_engine_update_status=3` atau `reboot_requested=true` |
| Offline > 3/7/30 hari | `last_connection` |

Detail per modul (antivirus, Adaptive Defense, firewall) memakai enum yang sama dan disimpan untuk diagnosis.

### 4.2 Alur penanganan otomatis bertahap

Permintaan asli repair protection otomatis lalu repair agent otomatis tetap **BLOCKED_UNSUPPORTED**, bukan dianggap selesai oleh fallback manual. API§3.3 belum menyediakan perintahnya. Tangga diagnosis berikut adalah fallback eksplisit; UI wajib membedakan dukungan, pekerjaan manual dan hasil yang sudah dikonfirmasi. Reboot hanya opsi terpisah yang operator aktifkan dan bukan sinonim repair. Jangan memakai endpoint Console privat, browser automation atau uninstall sebagai pengganti diam-diam. Setiap tahap memerlukan hasil/evidence, masa tunggu dan persetujuan sesuai CONTRACTS C7.

```text
Tahap 0  Deteksi
         Status ≠ Activated → buat finding "Proteksi bermasalah"
         Masa tenggang (default 30 menit) untuk status transien (installing, update)
              ↓ masih bermasalah
Tahap 1  Tindakan via API (bila relevan)
         • reboot_requested / waiting for reboot + kebijakan reboot diaktifkan → usulkan reboot
             workstation: mode off/approval/otomatis terpisah, default approval, countdown rekomendasi8 jam
             server/kritis: wajib approval
         • Profil konfigurasi tidak sesuai standar site → usulkan assign profil (approval)
              ↓ masih bermasalah
Tahap 2  Repair protection (manual)
         Buat Incident "Repair protection diperlukan" dengan detail
         reinstall_protection_error (kode, tanggal, langkah gagal) dan tautan ke Console
              ↓ masih bermasalah / agent tidak melapor
Tahap 3  Repair agent (manual)
         Eskalasi Incident "Repair agent diperlukan" dengan detail reinstall_agent_error,
         prioritas naik, notifikasi PIC
              ↓
Selesai  Status kembali sehat sesuai modul/profil, fresh dan stabil → kasus kesehatan saja
         boleh selesai sesuai kebijakan close/Hold/approval; tidak menutup Incident ancaman/manual
```

- Disabled protection pada server/aset kritis langsung menjadi Incident High.
- Status `No license` tidak diperbaiki; masuk laporan kapasitas lisensi.
- Endpoint offline tidak dieskalasi sebagai error proteksi; masuk daftar offline.
- Jika WatchGuard kelak menambah API repair, Tahap 2–3 dapat diganti menjadi aksi API tanpa mengubah alur.

## 5. Modul B — Deteksi ancaman → Incident → Full scan

### 5.1 Sumber deteksi

| Sumber | Data | Catatan |
|---|---|---|
| Security events export | Ingest1 Malware,2 PUP,4 Exploit,6 Virus,18 IOA per device. Jalur aktivitas otomatis memakai1/2/4 tanpa skor wajib; IOA tanpa skor default review. | Page lengkap sesuai OpenAPI dan validasi top/skip per operasi. Polling overlap/checkpoint, dedup scoped event/device/type. Backfill tidak langsung mengirim scan. |
| ThreatSync incidents | `category`, `threatScore` (High 7–8, Critical 9–10), `entities` | Untuk IOA dan konteks skor. |

Satu kejadian bisa muncul di kedua sumber. Korelasi memakai endpoint + bukti threat key yang cocok + jendela waktu (bukan waktu/hostname saja). Satu episode endpoint = satu Incident DC; satu insiden provider dengan beberapa entitas ditautkan ke beberapa workflow endpoint. Hanya semua entitas selesai/ditinjau yang boleh menutup insiden provider (CONTRACTS C2/C3).

### 5.2 Aturan pemicu (default, dapat diubah per site)

```text
Jalur aktivitas: kategori ∈ {Malware, PUP, Exploit} dari event export, tanpa rating wajib
  ATAU jalur insiden: kategori ternormalisasi ∈ {IOA, Malware, PUP, Virus, Exploit}
       dengan 7 <= threatScore <= 10 (bukan memetakan AV/Unknown secara asal)
DAN endpoint terpetakan ke site
DAN tidak ada workflow aktif untuk endpoint + episode yang sama
```

Severity Incident: dari `threatScore` bila tersedia; jika tidak, default per kategori (Malware/Exploit = High, PUP = Medium), dapat diatur. Prioritas dinaikkan untuk server/aset kritis dan deteksi berulang.

### 5.3 Alur

```text
Deteksi → finding → Incident DC (Open)
   ↓ evaluasi kebijakan
   ├─ target/site belum tervalidasi → Blocked / review pemetaan
   ├─ server / kritis / unknown type / no-auto → Awaiting approval
   └─ workstation tervalidasi dalam cakupan → sesuai mode aturan (aset opsional)
   ↓
POST /immediatescan  scan_scope=0 (full system), execution_window default 24 jam
   ↓ API menerima task_id
Incident → In Progress
ThreatSync → status read + komentar "Full scan oleh dc-check, task <id>"
   ↓ polling /tasks/1/{taskId}/jobs/{jobId}/status per endpoint
   ├─ 0/1 Pending/In progress → tunggu; endpoint offline → "Menunggu endpoint"
   ├─ 3/4/5/7 Failed/Expired/Canceled/Timeout → Needs review, eskalasi
   └─ 2 Succeeded → baca /results
         ├─ affected_items = 0 → Verifying (masa observasi)
         └─ affected_items > 0 → scan ulang sekali;
                                 masih > 0 → usulan isolasi (wajib approval)
   ↓ masa observasi lolos, tidak ada deteksi baru
Incident → Resolved (resolution: Cleaned, oleh sistem)
ThreatSync → closed + komentar ringkasan
```

### 5.4 Syarat auto-close (semua wajib terpenuhi)

1. Scan berstatus **Succeeded di seluruh endpoint terkait**.
2. Scan dimulai setelah deteksi yang ditangani.
3. Hasil/recipient/status lengkap dengan makna counter tervalidasi; missing/null bukan nol. affected_items=0 saja tidak menjamin aman. Scan benar-benar mulai setelah kejadian terakhir, bukan baru task diterima.
4. Semua stream deteksi/proteksi relevan fresh dan lengkap selama observasi(default30 menit), tanpa occurrence/entitas/bukti baru atau respons wajib tersisa.
5. Tidak ada Hold/Take over, permintaan approval tersisa, kill switch, atau pekerjaan manual/non-EPDR yang akan dilewati.
6. Mode penutupan dan batas kategori/skor di UI mengizinkan. Default Critical/IOA/Exploit/server/kritis perlu review; global ceiling dan bukti menentukan izin efektif. Scan bersih sendiri tidak cukup membantah IOA/Exploit. Close approval mempunyai record/expiry/recheck tersendiri.
7. Penutupan ThreatSync diagregasi dari semua entitas/workflow terkait; DC episode satu endpoint boleh selesai tanpa menutup provider incident yang masih punya target belum tertangani. CONTRACTS C6 adalah kontrak final.

`remediated=true` dari ThreatSync dipakai sebagai bukti tambahan, bukan satu-satunya syarat. Status `Verified` pada Incident tetap manual.

### 5.5 Reopen

Deteksi ulang ancaman yang sama pada endpoint yang sama dalam 7 hari (dapat diatur) **membuka kembali Incident lama** dengan prioritas naik, bukan membuat Incident baru. Kambuh kedua dapat memicu usulan isolasi(approval) bila fitur aktif; scan tetap dijalankan sesuai kebutuhan/bukti, bukan digantikan otomatis oleh isolasi.

## 6. Model status

| Lapisan | Nilai |
|---|---|
| ThreatSync incident | `new`, `read`, `closed` |
| Task scan per endpoint | 0–7 sesuai API |
| Workflow automation dc-check | Detected, Awaiting approval, Dispatching, In progress, Waiting endpoint, Verifying, Resolved, Needs review, Held, Simulated |
| Incident dc-check | Open, In Progress, Resolved, Verified (enum existing) |

Pemetaan: dispatch pending tetap Open; hanya accepted command atau mulai manual eksplisit yang membuat Incident In Progress. Waiting endpoint/Verifying tetap In Progress setelah acceptance. Resolved -> Resolved; Verified manual. Workflow juga mendefinisikan awaiting_close_approval dan ready_for_manual_close sesuai CONTRACTS C6; status UI tidak menambah enum WatchGuard.

Aturan sinkronisasi:
- Scan selesai ≠ Incident selesai.
- WatchGuard ditutup manual ≠ Incident DC selesai; tercatat sebagai bukti di timeline.
- Gagal sinkron status ke WatchGuard → ulangi sinkron status, **jangan ulangi scan**.
- Request scan timeout dengan hasil tidak diketahui → cek `/tasks` dulu, jangan langsung kirim ulang.

## 7. Integrasi Incident dc-check

- `incidents.device_id` menjadi nullable; tambah `epdr_endpoint_id`; constraint minimal salah satu terisi (D2). Seluruh kode Incident yang menganggap aset selalu ada harus diperiksa (detail, tabel, laporan, notifikasi overdue).
- Tambah sumber Incident (`source`: manual / checklist / siem / epdr) dan referensi WatchGuard.
- `resolution_category` perlu nilai baru, misalnya `Security`, untuk penutupan oleh automation.
- Panel **WatchGuard / EPDR** di detail Incident: insiden sumber, endpoint, skor, task scan per endpoint, hasil, timeline, tombol Approve / Hold / Take over / Close with reason.
- Incident manual atau gabungan non-EPDR tidak pernah ditutup otomatis.

## 8. Pengaman

- Aturan baru wajib mulai dari **Simulasi**; pindah ke Otomatis memerlukan konfirmasi admin kedua.
- Aturan berversi; setiap tindakan mencatat versi aturan.
- Cooldown per endpoint per tindakan, batas tindakan per jam per site.
- **Circuit breaker**: lebih dari N scan otomatis dalam 15 menit (default 20) atau IOC/hash yang sama di banyak endpoint → automation site dijeda, admin diberi tahu, agregat kampanye terpisah ditautkan ke Incident endpoint (bukan membuat Incident tanpa target yang melanggar CHECK).
- Kill switch global (superadmin) dan per site (admin site), diperiksa ulang sesaat sebelum pengiriman.
- Data sinkronisasi kedaluwarsa atau enum tidak dikenal → tidak ada auto-scan/auto-close.
- False positive saat close → tawarkan pengecualian berbasis hash/endpoint dengan alasan dan kedaluwarsa wajib.
- Koordinasi dengan automation policy ThreatSync di Console: kategori yang dikelola dc-check tidak boleh tumpang tindih dengan policy Console. Tindakan dari luar dc-check (`actionsPerformed`) tetap direkam di timeline.

## 9. UI per site

### 9.1 Settings › WatchGuard (superadmin)
- Kill switch global, batas global, daftar tindakan yang boleh diaktifkan site.

### 9.2 Site › WatchGuard EPDR
1. **Koneksi** (superadmin): region, Account ID, Access ID + password read-only dan read-write, API key. Secret write-only (hanya indikator "Terkonfigurasi"; field kosong = pertahankan nilai lama, pola NCM). Tombol **Tes koneksi** yang menguji autentikasi, Accounts, Endpoint Security, dan ThreatSync terpisah.
2. **Sinkronisasi**: interval endpoint (default 15 menit) dan insiden/event (default 5 menit), status sinkronisasi terakhir.
3. **Kesehatan proteksi**: masa tenggang, aturan tangga eskalasi §4.2, profil standar workstation/server.
4. **Aturan deteksi**: builder berbasis form — kategori, skor, target (workstation/laptop/server), tindakan, mode eksekusi, mode penutupan, masa observasi, masa berlaku task, cooldown.
5. **Pemetaan endpoint**: saran pencocokan ke aset dc-check (opsional), flag "jangan pernah otomatis".
6. **Pengaman**: batas per jam, circuit breaker, kill switch site, penerima notifikasi (Telegram per site existing).

### 9.3 Monitor
- **Endpoint Security**: ringkasan seperti dashboard Console (protected/error/install error/disabled/no license, offline, outdated, pending restart) dan daftar endpoint bermasalah beserta tahap eskalasinya.
- **Threats**: aktivitas Malware/PUP/Exploit dan insiden ThreatSync, status automation, tautan ke Incident DC, antrean Awaiting approval / Needs review, laporan simulasi.

## 10. Hak akses

| Aksi | Superadmin | Admin site | Staff site |
|---|---|---|---|
| Kelola koneksi & kredensial | ✓ | – | – |
| Kill switch global | ✓ | – | – |
| Atur aturan & pengaman site | ✓ | ✓ | – |
| Ubah aturan ke Otomatis | ✓ | ✓ + konfirmasi admin kedua | – |
| Approve tindakan | ✓ | ✓ (bukan pengaju) | – |
| Kill switch site | ✓ | ✓ | – |
| Lihat endpoint, threats, Incident | ✓ | ✓ | ✓ (baca) |

Semua cek dilakukan di server; site/endpoint/akun diambil dari database, bukan dari input form.

## 11. Data model (migrasi SQL hand-written + journal)

Definisi tabel dan kolom ada di tiket implementasi (satu sumber kebenaran): koneksi & global (T02), endpoint & sync run (T03), perubahan `incidents` (T04), pengaturan site, deteksi & workflow (T05), aturan & evaluasi (T06), tindakan (T07), verifikasi & pengecualian (T08), kasus kesehatan proteksi (T09). Lihat `docs/superpowers/plans/2026-11-09-watchguard-epdr/`.

## 12. Worker

Worker terpisah `watchguard-worker` (pola `network-doc-worker`, flag `--run-once`), PostgreSQL sebagai koordinasi, advisory lock per koneksi:

1. Token per koneksi, cache sampai mendekati 3600 detik, refresh pada 401.
2. Sinkronisasi endpoint + status proteksi (paging).
3. Ambil event Malware/PUP/Exploit dan insiden ThreatSync.
4. Evaluasi tangga kesehatan proteksi dan aturan deteksi per site.
5. Buat tindakan: simulasi / approval / siap kirim.
6. Kirim tindakan siap (cek ulang kill switch, izin, criticality, cooldown).
7. Polling status task per endpoint → verifikasi → close / reopen / eskalasi.
8. Catat sync run, audit headless (`logAuditManual`), notifikasi.

Retry GET dengan backoff dan `Retry-After`; POST tidak diulang otomatis bila hasilnya tidak diketahui. Satu koneksi gagal tidak menghentikan koneksi lain.

Prasyarat: perkuat state machine approval/cancel/claim menjadi update bersyarat atomik (kelemahan di `actions/siem-response-actions.ts`), audit worker memakai atribusi headless.

## 13. Fase rilis

| Fase | Isi | Tiket |
|---|---|---|
| 1 | Klien API, koneksi per site, tes koneksi per layanan, sinkronisasi endpoint & status proteksi, Monitor › Endpoint Security | T01–T03 |
| 2 | Incident tanpa aset, deteksi Malware/PUP/Exploit + ThreatSync, Incident DC, panel EPDR | T04–T05 |
| 3 | Aturan dalam mode Simulasi dengan data nyata | T06 |
| 4 | Full scan dengan approval, polling task | T07 |
| 5 | Verifikasi, auto-close, reopen, circuit breaker, mode Otomatis | T08 |
| 6 | Tangga kesehatan proteksi (reboot, Incident repair manual) | T09 |
| 7 | Tindakan lanjutan: isolasi/release, kill process, quarantine, block/unblock IP dan assign profil (approval) | T10 |
| 8 | UI/settings coverage, metrik/notifikasi, bukti compliance, runbook, validasi release dan handoff | T11 |

Rencana implementasi per tiket: `docs/superpowers/plans/2026-11-09-watchguard-epdr/README.md`.

Mulai dari site yang kepemilikan akun dan pengujiannya dikonfirmasi operator di UI, lalu perluas ke site lain. Jangan auto-dispatch deteksi historis pada impor pertama atau saat pemulihan outage; activation boundary dan replay approval diatur UI.

## 14. Hal yang perlu diverifikasi sebelum/selama implementasi

- Pemetaan status "Installing…" di Console ke field API.
- Apakah `task_id` dari `/immediatescan` langsung bisa dipakai di `/tasks/1/{taskId}/jobs` dan berapa lama job muncul.
- Isi nyata `/results` untuk scan yang menemukan dan tidak menemukan ancaman.
- Nilai `category` ThreatSync yang muncul pada akun (casing, IOA, AV).
- Batas rate limit (tidak terdokumentasi) — pantau grafik API usage di Console saat simulasi.
- Hak tulis kredensial read-write untuk scan/reboot — diuji sekali pada endpoint uji yang disetujui.
- Automation policy ThreatSync yang aktif di Console tiap site.

## 15. Referensi

- [Endpoint Security Management API](https://www.watchguard.com/help/docs/api/Content/en-US/endpoint_security/WES_endpoint_security/v1/WES_endpoint_security.html) — OpenAPI [1.5.2](https://developer.cloud.watchguard.com/catalog-data/endpoint-security-apis-01/endpoint-security-apis-01-management-01/management/1.5.2/management-1.5.2.yaml)
- [ThreatSync Management API](https://www.watchguard.com/help/docs/api/Content/en-US/threatsync/v1/threatsync_management.html) — OpenAPI [1.2.0](https://developer.cloud.watchguard.com/catalog-data/threatsync-apis-01/threatsync-apis-01-management-01/threatsync-management/1.2.0/threatsync-management-1.2.0.yaml)
- [Authentication](https://www.watchguard.com/help/docs/api/Content/en-US/api_get_started/authentication.html)
- [ThreatSync actions](https://www.watchguard.com/help/docs/help-center/en-US/Content/en-US/WG-Cloud/ThreatSync/threatsync_actions_about.html)
