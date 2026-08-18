# AUDIT HANDOFF — dc-check

> Handoff untuk agent fresh. Seluruh konteks ada di dokumen ini — jangan asumsi di luar yang tertulis.
> Sumber: audit menyeluruh 2026-08-18 (9 scan domain paralel + sintesis + verifikasi manual). Dokumen pendamping (visual, satu kartu per temuan):
> `C:\Users\IT10\AppData\Local\Temp\claude\E--Vibe-dc-check\dc-check-audit.html`

## 1. Tugas

Perbaiki **semua 83 temuan** di daftar bawah (checklist), berurutan dari atas (severity). Tidak boleh ada yang terlewat. Setiap temuan berisi bukti, dampak, dan saran perbaikan yang sudah diteliti — periksa dulu klaimnya di kode, baru kerjakan; jika temuan ternyata tidak valid lagi, tulis alasannya di komentar commit, jangan diam-diam dilewati.

## 2. Konteks proyek (ringkas)

Next.js 16.1.6 App Router + React 19 + TypeScript strict + Tailwind v4, PostgreSQL + Drizzle (migrasi SQL di `drizzle/`, skema di `db/schema.ts`), server actions di `actions/`, logika di `lib/`, komponen di `components/`, worker & CLI di `scripts/`. Worker background: syslog-receiver, siem-parser/rules/alerts/retention/ai/snapshot, backup-scheduler, notifier overdue. Notifikasi & deep-link: Telegram bot. Deploy: Docker compose + script `deploy.sh`/`update.sh`/`update.ps1`. Lihat `AGENTS.md` untuk struktur lengkap (catatan: bagian testing di AGENTS.md basi — framework vitest SUDAH ada, lihat bagian 4).

## 3. Dua fitur yang dilaporkan rusak (verdict audit)

Kedua klaim user terverifikasi di kode (bukan dugaan):

1. **Link Telegram rusak** — `escapeTelegramMarkdown()` (lib/telegram.ts:66-68) meng-escape `[`, sedangkan `{incidentLink}` diisi nilai yang SUDAH berupa link `[Open incident #N](url)` lalu ikut di-escape. Hasil: penerima melihat teks literal, link tidak bisa diklik. Detail & perbaikan: temuan #06. "TelegramBroken": Verified in code: escapeTelegramMarkdown (lib/telegram.ts:66-68) escapes '[' to '\[' and renderTelegramTemplate (lib/telegram.ts:75-81) applies it to EVERY field including incidentLink, while actions/checklist.ts:191-193 passes incidentLink as a pre-rendered '[Open incident #N](url)' link — so every NOT-OK checklist alert and the settings test message render the literal text '[Open incident #5](...)' with no clickable target. Compounding: lib/siem/alerts.ts:26 hardcodes ?severity=High in the SIEM deep link, lib/notification-url.ts:32 prioritizes the stored DB host over APP_URL, and lib/base-origin.ts:7 forces https:// on plain-IP LAN hosts. The default template line 7 ('Open: {incidentLink}') is affected on every alert; no test covers it (lib/telegram.test.ts tests only a plain token).

2. **PIC per grup rusak** — skema Drizzle `text` vs migrasi `jsonb` (db/schema.ts:102 vs drizzle/0029_devices_pics.sql:4), kolom `devices.responsible_groups` tanpa migrasi. Detail & perbaikan: temuan #01. "PicBroken": Verified in code: db/schema.ts:102 declares users.responsible_for_groups as text(...).$type<string[]>() while drizzle/0029_devices_pics.sql:4 creates it as jsonb — bindGroup (actions/device-groups.ts:182) and detachOwners (:193) write JS arrays through the text-mode column, node-pg serializes them to a PG array literal which jsonb rejects (22P02) for any non-empty list, so owner assignment always fails with the generic 'Gagal menyimpan grup.'; an empty write stores '{}' (a JSON object) which then throws in getDeviceGroups' iteration (actions/device-groups.ts:52-58), 500ing /admin/device-groups. Additionally devices.responsible_groups (db/schema.ts:181) has no migration anywhere (0029 adds only the users column), and db.query.devices calls without column projection (actions/master-data.ts:232,306) select it — failing on any DB that never received the column ad hoc. The PIC-per-group feature has never persisted a non-empty owner list.

## 4. Perintah verifikasi

- `npm run test` — vitest. **PENTING: saat ini 11 test merah (temuan #43) — jalankan dulu sebagai baseline sebelum mengubah apa pun, lalu pastikan setelah fix tidak ada test baru yang merah.**
- `npm run lint` — ESLint.
- `npm run build` — build produksi (~10 menit). Saat audit: exit 0, nol warning.
- `npx tsc --noEmit` — **saat ini gagal 19 error di 3 file tes (temuan #51); jangan jadikan sebagai penanda sukses sebelum temuan itu dikerjakan.**
- `npm run db:migrate` — apply migrasi.
- **JANGAN** jalankan `npm run db:generate` sebelum temuan #13 selesai (snapshot journal 0024–0030 hilang — generate berikutnya akan menghasilkan migrasi merusak). Temuan #01/#09 menyangkut drift schema↔DB: sinkronkan skema & buat migrasi secara manual/hati-hati dulu.
- Commit: conventional style, imperatif, spesifik (contoh riwayat: `fix(db):`, `feat(network):`, `fix(build):`). Commit kecil per temuan, atomic. Jangan commit `.env`, file DB, atau upload.

## 5. Aturan kerja

1. Kerjakan satu temuan per satu, urut dari #01. Setelah selesai + diverifikasi, centang `[x]`.
2. Jangan ubah file di luar cakupan temuan (no unrequested refactor). Temuan #37 (navbar mati) dan #50 (loading-state mati) = instruksi menghapus — verifikasi dulu tidak ada impor, baru hapus.
3. Perubahan DB: buat migrasi Drizzle baru (atau SQL tangan konsisten dengan gaya `drizzle/`) + uji `npm run db:migrate` terhadap DB dev. Perhatikan pola commit terbaru: urutan migrasi harus sejajar dengan `__drizzle_migrations`.
4. UI change → uji manual di browser pada jalur yang terdampak.
5. Kalau sebuah perbaikan butuh keputusan yang tidak bisa diambil dari dokumen ini (mis. arah produk), kerjakan opsi paling aman (fail-closed, tidak menghapus data) dan catat keputusan di commit.
6. Sesudah semua temuan di gelombang 1: jalankan `npm run test` + `npm run build` + `npx tsc --noEmit` (jika #51 sudah dibereskan), pastikan 0 merah.

## 6. Urutan kerja (3 gelombang)

### Gelombang 1 — blocker (prioritas tertinggi, kerjakan lebih dulu)

1. **Sinkronkan schema↔DB untuk PIC** (temuan #01): ubah `users.responsible_for_groups` menjadi `jsonb` di skema (cocokkan dengan migrasi 0029), tambahkan migrasi untuk kolom `devices.responsible_groups` (temuan #09), regenerasi snapshot 0024–0030 sebelum `db:generate` (temuan #13).
2. **Perbaiki escaping link Telegram** (temuan #06): jangan escape nilai yang sudah berupa link (`{incidentLink}`); escape hanya field entitas. Tambah tes render template (lihat `lib/telegram.test.ts`).
3. **Aktifkan CSRF `/api/*`** (temuan #04): matcher middleware mengecualikan `/api` — perluas matcher atau pindahkan gate ke route handler.
4. **`submitChecklist` transaksional** (temuan #08): gagal di tengah → rollback, bukan data parsial; retry tidak boleh menduplikasi.
5. **Upload aman** (temuan #03): validasi tipe & ukuran server-side, `nosniff`/CSP untuk rute `/uploads`.
6. **Env deploy split-brain + worker hilang** (temuan #14, #15): satu file env untuk compose & deploy.sh; tambahkan 4 service yang terlewat ke ketiga script deploy.

### Gelombang 2 — fitur patah berikutnya

7. **Guard read-only server actions** (temuan #02): tanpa sesi aktif → tolak, jangan jatuh ke semua-site.
8. **Revoke sesi** (temuan #05): verifikasi `isActive`/versi password di DB saat verifikasi JWT.
9. **Integritas data**: `deleteDevice forceDelete` (temuan #07), `updateChecklist` (temuan #23), `deleteRack` (temuan #11), transaksi `device-groups` (temuan #26), validasi site pada `bindGroup` (temuan #27), skoping site `submitChecklist` (temuan #44).
10. **Rack & port**: validasi kapasitas U (temuan #10), 0.5U (temuan #32), `updatePort` jangan menghancurkan link (temuan #34), slot override dibatasi (temuan #35).
11. **Telegram lanjutan**: severity SIEM (temuan #16), prioritas `APP_URL` (temuan #17), skema http/https (temuan #18), escape SIEM (temuan #19), retry antrean gagal (temuan #20), overdue multi-recipient (temuan #21), chunking 4096 (temuan #22), mapping severity mati (temuan #56).
12. **RBAC & rute**: panggil guard rack-manage (temuan #12), redirect staff di device-groups (temuan #29) & audit-log (temuan #40), `switchSite` re-check `isActive` (temuan #67), IDOR `getUserById` (temuan #76).

### Gelombang 3 — utang lain

13. **DB**: FK syslog 0016 (temuan #41), backfill 0024/0025 (temuan #42), journal (temuan #73, #74), unique `racks.name` (temuan #33), constraint 0029 (temuan #72), relasi Drizzle hilang (temuan #31).
14. **Kualitas**: 11 tes merah (temuan #43), gate `tsc` (temuan #51), `getAuditLogs` WHERE (temuan #25), status incident (temuan #24), konflik optimistik (temuan #61), test field-audit-card (temuan #60).
15. **UI/UX**: i18n (temuan #38), error boundaries (temuan #39), kotak pencarian (temuan #48), navbar & loading-state hapus (temuan #37, #50), shim `.text-white` (temuan #49), pagination (temuan #52), theme-toggle & a11y dropdown (temuan #79–83).
16. **Ops**: rate limit XFF (temuan #45), env validation (temuan #46), `MAX_FILE_SIZE` mati (temuan #47), `.dockerignore` (temuan #79–83), font (temuan #79–83), syslog port (temuan #83), `update.sh` service (temuan #68), settings gate (temuan #69), error leak API (temuan #77), AGENTS.md basi (temuan #78).

> Catatan penomoran gelombang 3 bersifat panduan — daftar temuan bernomor di bawah adalah sumber kebenaran. Temuan yang diberi tanda `?` pada nomornya: cari berdasarkan judul di daftar bawah.

## 7. Indeks domain

| Domain | Total | Kritis | Tinggi | Sedang | Rendah |
|---|---|---|---|---|---|
| device-groups | 9 | 1 | 0 | 6 | 2 |
| auth-admin-routing-i18n | 10 | 0 | 3 | 4 | 3 |
| cross-cutting | 13 | 0 | 3 | 6 | 4 |
| telegram-messaging | 15 | 0 | 1 | 7 | 7 |
| incidents-checklist-fieldaudit | 6 | 0 | 1 | 2 | 3 |
| database-schema-migrations | 7 | 0 | 2 | 2 | 3 |
| network-rack-management-faceplate | 11 | 0 | 2 | 5 | 4 |
| ui-build | 12 | 0 | 2 | 5 | 5 |

## 8. Daftar temuan lengkap (83)

Centang `[x]` setelah temuan selesai dikerjakan **dan** diverifikasi. Kerjakan urut dari atas (severity).

### Band KRITIS — 1 temuan

- [ ] **#01 · CRITICAL · bug · device-groups** — PIC owner persistence is broken: users.responsible_for_groups is declared `text` in the Drizzle schema but the migration created `jsonb` — every owner save fails or corrupts the column
  - **File:** `db/schema.ts:102 (users.responsibleForGroups); drizzle/0029_devices_pics.sql:4; actions/device-groups.ts:177-196`
  - **Bukti:** Verified: schema.ts:102 declares text("responsible_for_groups").$type<string[]>().default(sql`'[]'::jsonb`).notNull(), but drizzle/0029_devices_pics.sql:4 creates it as jsonb NOT NULL DEFAULT '[]'::jsonb. Drizzle's text column has no mapToDriverValue, so bindGroup (actions/device-groups.ts:182) writes `[...current].map(String)` and detachOwners (:193) writes `list.map(String)` as raw JS arrays; node-pg serializes a JS array to a PG array literal ({"1","2"}), which jsonb rejects with 22P02 'invalid input syntax for type json'. An empty-array write stores `{}` (a valid jsonb OBJECT), which then throws in getDeviceGroups (actions/device-groups.ts:52-58 `for (const gid of u.responsibleForGroups ?? [])` — `{}` is not iterable), 500ing /admin/device-groups.
  - **Dampak:** The core of the PIC feature — assigning owners to a group — fails on every save with a misleading generic error ('Gagal menyimpan grup.') while the group row is already committed. Any detach that empties a user's list stores `{}`, which then crashes getDeviceGroups for the whole site. The feature has never worked with a non-empty owner list.
  - **Saran:** Declare the column as jsonb("responsible_for_groups").$type<string[]>().notNull().default(sql`'[]'::jsonb`) so Drizzle JSON.stringify's on write (do NOT change the deployed column to text — it is jsonb). Then generate a corrective migration and verify with a real save + re-read. Same fix pattern applies to devices.responsible_groups.

### Band TINGGI — 14 temuan

- [x] **#02 · HIGH · misscode · auth-admin-routing-i18n** — Read-only server actions have no auth guard; missing session/activeSiteId silently drops the site filter and returns ALL sites' inventory
  - **File:** `actions/master-data.ts`; `actions/rack-management.ts`; `actions/brands.ts`; `actions/rack-layout.ts`; `actions/dashboard.ts`; `actions/grid.ts`; `actions/report.ts`; `actions/checklist.ts`; `actions/analytics.ts`; `actions/read-actions-auth.test.ts`; `lib/action-auth.ts`
  - **Bukti:** Fixed and code-level verified: the named reads now call `requireActiveSiteAction()` and return neutral results without querying when the session or active site is missing. `getDevices` and `getRacks` always include the concrete active-site predicate; `getRackById` requires both rack ID and active-site ID; global categories and brands remain globally queried only after the authenticated active-site check. The same optional-site pattern found during tracing in rack layout/stats, dashboard, audit grid, report/export, recent checklists, and device health history was hardened with mandatory site predicates and neutral failure shapes. `actions/read-actions-auth.test.ts` covers unauthenticated/no-site no-DB behavior and active-site predicate parameters; it passed 3/3. The combined Wave suite passed 31/31, targeted ESLint reported 0 errors with 6 existing warnings, and `npm run build` passed. `npx tsc --noEmit` still reports the known baseline 18 errors in `actions/auth.test.ts`, `lib/env.test.ts`, and `lib/siem/receiver.test.ts`; no new error remains in the #02 action/test files. Live authenticated/database verification remains unavailable without PostgreSQL.
  - **Dampak:** Before this fix, directly invoked server actions could return cross-site devices, racks, checklist/report data, and device history, while global taxonomy reads were callable without authentication. The action boundary now fails closed and site-scoped queries cannot silently become unfiltered; session revocation and membership changes after JWT issuance remain separate finding #05 concerns.
  - **Saran:** The recommended controls are implemented: use `requireActiveSiteAction()` at each read boundary, return the existing neutral shape on failure, and apply a mandatory concrete site predicate to every per-site query. Keep global categories/brands behind the active-site authentication boundary and add authenticated integration tests against PostgreSQL when the runtime environment is available.

- [x] **#03 · HIGH · bug · cross-cutting** — Stored XSS and disk DoS via uploads: no server-side type/size validation, files served publicly same-origin as image/svg+xml with no nosniff/CSP
  - **File:** `lib/upload.ts`; `actions/checklist.ts`, `actions/incidents.ts`, `actions/master-data.ts`, `actions/brands.ts`, `actions/settings.ts`, `actions/users.ts`; `app/api/uploads/[...path]/route.ts`; `app/uploads/[...path]/route.ts`; `middleware.ts`
  - **Bukti:** Fixed and locally verified: the shared writer enforces the configured `MAX_FILE_SIZE` (5 MiB default) before `arrayBuffer()`, detects JPEG/PNG/WebP/GIF/ICO magic bytes, rejects SVG for new uploads, derives canonical extensions, uses random names and allowlisted directories, and confines cleanup to stored `/uploads` paths. All direct image writers use the helper. The internal serving route derives raster MIME from bytes, rejects unknown content, serves legacy SVG only as an attachment, checks resolved-path containment, and emits `nosniff`, restrictive CSP, CORP, and safe `Content-Disposition` headers. Middleware rewrites `/uploads/*` to the internal handler while the compatibility route preserves the existing URL shape. `npx vitest run lib/telegram.test.ts lib/csrf.test.ts lib/upload.test.ts` passed 28/28, targeted ESLint reported 0 errors, and `npm run build` passed. Built-server smoke testing returned 200 for an existing PNG with `Content-Type: image/png`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, and `Cross-Origin-Resource-Policy: same-origin`; a temporary legacy SVG returned `application/octet-stream` with `Content-Disposition: attachment` and the same security headers. The temporary fixture was removed and the server stopped. Authenticated upload/DB authorization testing remains unavailable without local PostgreSQL.
  - **Dampak:** Before this fix, arbitrary-size uploads and active SVG responses enabled disk exhaustion and a same-origin stored-XSS path. The new-upload and serving paths now block that demonstrated chain; residual deployment risk is limited to authenticating the full workflow against the real database and separately reviewing client-advertised limits/types and database authorization for deletion.
  - **Saran:** The controls for this finding are implemented: validate size before buffering, allowlist magic bytes/extensions, use random names and confined deletion, route `/uploads/*` through the internal handler, and send `nosniff`, restrictive CSP, CORP, and safe disposition headers. Follow up separately by aligning remaining client upload copy with the 5 MiB/no-new-SVG policy and by verifying authorization against the current database row before deleting an existing upload.

- [x] **#04 · HIGH · bug · auth-admin-routing-i18n** — CSRF gate for /api in middleware is dead code — the matcher's negative lookahead excludes every /api path
  - **File:** `middleware.ts`; `app/api/admin/restore/route.ts`; `components/admin/backup-form.tsx`; `lib/csrf.ts`
  - **Bukti:** Fixed and code-level verified: the matcher now includes `/api`, API paths enter the CSRF gate before `next-intl`, state-changing non-exempt requests require a matching `csrf` cookie/header, the restore route repeats the check before rate-limit/lock/form parsing, and the backup form sends the non-HttpOnly token header. `lib/csrf.test.ts` passed 17/17 and targeted ESLint reported 0 errors. Upload-route runtime smoke testing also confirmed the built middleware rewrite path, but an authenticated API mutation smoke test remains unavailable without PostgreSQL and a live session.
  - **Dampak:** Before this fix, the documented CSRF protection for `/api` silently never executed, leaving any future state-changing route that trusted middleware exposed. The middleware and restore defense-in-depth checks now enforce the token boundary; the remaining verification is exercising each authenticated mutation and preserving the explicit health/metrics and SIEM-ingest exemptions in a deployed environment.
  - **Saran:** The code fix is implemented: keep `/api` in the middleware matcher, short-circuit API requests through the CSRF gate before `next-intl`, and retain the restore route's defense-in-depth check plus the client token header. Follow up with authenticated integration smoke tests against PostgreSQL whenever that environment is available, and require the same token check for every new state-changing API route.

- [ ] **#05 · HIGH · incomplete · cross-cutting** — Deactivated users / password changes do not revoke existing JWT sessions (7-day expiry, no DB check on verify)
  - **File:** `lib/session.ts:46,74-91 (verifySession); middleware.ts:69 (decrypt); actions/auth.ts (login)`
  - **Bukti:** verifySession() and middleware decrypt() return JWT payload fields directly without checking users.isActive or any session version; users.isActive is consulted only in login(). Session cookie expiry is 7 days (lib/session.ts:46).
  - **Dampak:** After an admin deactivates a user, resets their password, or changes their role, the user keeps full access for up to 7 days — a material compliance failure for an audit tool and an account-takeover window after credential compromise.
  - **Saran:** Embed a sessionVersion/updatedAt claim in the JWT and check users.isActive + version on every verifySession(), or use a server-side session store with immediate revocation.

- [x] **#06 · HIGH · bug · telegram-messaging** — Markdown escaping destroys the incident deep-link in checklist Telegram alerts — recipients get literal '[Open incident #N](url)' text
  - **File:** `lib/telegram.ts`; `actions/checklist.ts`; `actions/settings.ts`; `lib/telegram.test.ts`
  - **Bukti:** Fixed and code-level verified: `renderTelegramTemplate` now accepts an explicit trusted Markdown allowlist limited to `incidentLink`; only generated checklist/settings links opt in, while ordinary fields and untrusted incident-link values remain escaped. `lib/telegram.test.ts` covers normal escaping, entity escaping, trusted links, and default escaping; the combined Wave 1 suite passed 28/28. Live Telegram delivery/parsing remains unverified because no local bot is available.
  - **Dampak:** Before this fix, the headline requirement 'direct link in telegram message' silently failed for NOT-OK checklist alerts and the settings test message because the already-rendered link was escaped as ordinary text. Generated allowlisted links now retain Markdown link syntax while untrusted values remain escaped; the remaining risk is live Bot API/Telegram-client behavior and other message templates that are outside this finding.
  - **Saran:** The escaping fix is implemented: escape entity fields by default and opt into raw Markdown only for the generated `incidentLink` value. Follow up with a live bot delivery smoke test when credentials are available, and apply the same explicit allowlist discipline to future SIEM/deep-link templates rather than introducing a global raw-Markdown exemption.

- [ ] **#07 · HIGH · bug · cross-cutting** — deleteDevice forceDelete destroys checklist history then fails on incidents FK (RESTRICT) — no transaction, permanent data loss
  - **File:** `actions/master-data.ts:336-344; db/schema.ts:215,225-226`
  - **Bukti:** forceDelete deletes checklistItems first, then db.delete(devices). incidents.deviceId references devices.id with no onDelete (RESTRICT) and checklist_items.deviceId is NOT NULL RESTRICT; incidents.checklistItemId is set-null. Verified the delete sequence has no db.transaction wrapper.
  - **Dampak:** Force-deleting a device that has incidents deletes the checklist/audit history permanently, then the device DELETE throws an FK violation, the catch returns a generic error, and the device remains — the operation fails AND the history is already gone.
  - **Saran:** Wrap in db.transaction; before deleting, handle incidents (block and require incident deletion first, or reassign) and only proceed if every dependent FK can be satisfied; add tests covering this path.

- [ ] **#08 · HIGH · bug · incidents-checklist-fieldaudit** — submitChecklist is not transactional; mid-loop failure leaves partial data and retry duplicates items/incidents
  - **File:** `actions/checklist.ts:63-123,213-216; db/schema.ts:212-219`
  - **Bukti:** checklistEntries insert (line 63), the per-device checklistItems insert loop (82-121) and createIncidentsForChecklistItems (123) run with no db.transaction wrapper; the catch returns 'Failed to submit checklist' without rollback. checklistItems has only an id PK — no unique index on (entry_id, device_id). createIncidentsForChecklistItems dedupes via onConflictDoNothing on incidents.checklistItemId (actions/incidents.ts:333), but a retry generates fresh item ids so the conflict never fires.
  - **Dampak:** If any insert/upload fails partway, the entry and earlier items stay committed while the UI reports failure; resubmission creates a second entry plus duplicate checklist_items and duplicate incidents for the same devices — the exact duplicate-incident class the recent fire-and-forget fix tried to prevent.
  - **Saran:** Wrap entry + item + incident creation in a single db.transaction; add a unique index on checklist_items(entry_id, device_id) with onConflictDoNothing on item insert so retries are idempotent; return failure only after rollback.

- [ ] **#09 · HIGH · misscode · database-schema-migrations** — devices.responsible_groups exists in the Drizzle schema but no migration ever creates it — and nothing reads/writes it; poisons db:generate and can crash fresh DBs
  - **File:** `db/schema.ts:181; drizzle/0029_devices_pics.sql (users column only)`
  - **Bukti:** Verified: schema.ts:181 declares responsibleGroups: text("responsible_groups").$type<string[]>().default(sql`'[]'::jsonb`).notNull() on devices, but grep of every drizzle/*.sql file finds zero migrations creating devices.responsible_groups — 0029 adds only users.responsible_for_groups plus the device_groups/device_pics tables. Repo-wide grep finds no reader/writer of the column in app code. Meanwhile db.query.devices.findFirst/findMany without an explicit columns projection (e.g. actions/master-data.ts:232-234, 306-308) selects all mapped columns, so on any DB where the column was never created those queries fail with 'column does not exist'.
  - **Dampak:** Fresh/existing databases lack the column: the next `npm run db:generate` emits an unexpected ALTER TABLE devices ADD COLUMN (and db:push would alter the live DB), and any devices query selecting all columns fails on databases that never got the column ad hoc. New maintainers may also write PIC data into a column nothing reads.
  - **Saran:** Either add an idempotent migration ALTER TABLE devices ADD COLUMN IF NOT EXISTS responsible_groups jsonb NOT NULL DEFAULT '[]'::jsonb (mirroring 0029's users column) and wire it intentionally, or remove the field from schema.ts if per-device groups are no longer intended; then regenerate the missing meta snapshot.

- [ ] **#10 · HIGH · misscode · network-rack-management-faceplate** — Rack capacity (totalU) never validated: multi-U devices can overflow the rack via drag-drop or forms and vanish from the diagram
  - **File:** `app/[locale]/(dashboard)/admin/rack/api/update-position/route.ts; actions/master-data.ts:167-177,237-246 (addDevice/updateDevice)`
  - **Bukti:** The update-position route only calls checkRackCollision (overlap vs other devices) and never compares rackPosition + uHeight - 1 against the target rack's totalU; same gap in addDevice/updateDevice. The drag-drop UI creates a DroppableSlot per U row, so a 4U device can be dropped at U41 of a 42U rack. Rendering then computes topRow = totalU - (u + uHeight - 1) + 1 = 0 or negative (invalid CSS grid line), the device is drawn off the chassis, and getRackLayout pushes occupiedU beyond totalU so freeU goes negative and occupancy shows >100%.
  - **Dampak:** From the standard UI a multi-U device can be placed overflowing the rack: it disappears from the diagram, occupancy stats show negative free U and >100%, and collision checks accept states the layout cannot render.
  - **Saran:** Fetch the target rack's totalU in update-position/addDevice/updateDevice and reject placements where rackPosition < 1 or rackPosition + uHeight - 1 > totalU (mirror the client-side U option list); also pass totalU into checkRackCollision.

- [ ] **#11 · HIGH · bug · network-rack-management-faceplate** — deleteRack never blocks or cleans devices referencing the rack; deleted rack silently resurrects in the layout with default 42U
  - **File:** `actions/rack-management.ts:174-188; actions/rack-layout.ts:121-132; db/schema.ts:173`
  - **Bukti:** deleteRack simply runs db.delete(racks) with no pre-check; devices.rack_name is free text with no FK to racks, so the delete always succeeds while the catch message 'Gagal menghapus rak ini karena mungkin masih berisi perangkat server aktif' describes a guard that does not exist. getRackLayout dynamically recreates any rack referenced by a device with totalU 42 and no zone.
  - **Dampak:** Rack CRUD is broken for any rack with devices: the delete reports success but the rack reappears in /admin/rack (default 42U, lost zone), devices keep a stale rackName, and the user-facing error message is a lie.
  - **Saran:** Either refuse deletion when devices reference the rack (count devices with eq(devices.rackName, name) first and return the real message) or cascade-clear rackName/rackPosition on referencing devices inside a transaction.

- [ ] **#12 · HIGH · misscode · auth-admin-routing-i18n** — Admin rack-manage page: intended auth guard imported but never invoked — staff and unauthenticated users see the full rack admin UI
  - **File:** `app/[locale]/(dashboard)/admin/rack-manage/page.tsx:1-8,28-36`
  - **Bukti:** Verified: the page is 'use client', imports verifySession from '@/lib/session' and redirect from 'next/navigation' (lines 7-8), but never calls either — the component renders the full rack admin UI for any session. Also, lib/session.ts starts with 'import "server-only"', so this client component pulls a server-only module into the client graph.
  - **Dampak:** Authorization is not enforced at the page level for /admin/rack-manage: any logged-in user (staff included) sees and can drive the rack admin UI; write actions are only guarded by requireActiveSiteAdminAction and the read actions feeding it are not role-scoped.
  - **Saran:** Remove the unused imports; convert the page to a server component that calls verifySession() with an admin/superadmin check (like sibling admin pages) before rendering; if it must stay client-side, wrap it in a guarded server page. Fix getRacks/getRackById scoping per the read-action finding.

- [ ] **#13 · HIGH · tech_debt · database-schema-migrations** — Meta snapshots out of sync: no snapshots for migrations 0024-0030 — next drizzle-kit generate produces a broken/destructive migration
  - **File:** `drizzle/meta/_journal.json`
  - **Bukti:** Verified: the newest snapshot file is meta/0023_snapshot.json while the journal registers 30 entries (0024_siem_per_site through 0030_device_faceplate have SQL but no matching *_snapshot.json). None of the 0024-0030 changes (per-site tenancy, PIC tables, rack audit flag, faceplate columns, base URL, responsible_for_groups, network_ports.port_index) exist in the diff base.
  - **Dampak:** The next `npm run db:generate` diffs schema.ts against the stale 0023 snapshot and emits a migration re-creating objects that already exist in any DB that ran 0024-0030 (duplicate CREATE TABLE device_groups/device_pics, duplicate columns, a jsonb->text conversion of responsible_for_groups that risks stored data). Applying it fails or corrupts; db:push has the same hazard against live DBs.
  - **Saran:** Regenerate the snapshots by running generate against a fresh DB that has all migrations applied, then commit the missing 0024-0030 snapshot files — or remove db:generate/db:push from npm scripts to prevent accidental drift.

- [ ] **#14 · HIGH · misscode · ui-build** — deploy.sh/update.sh/update.ps1 melewatkan 4 service: siem-ai, siem-snapshot, incidents-overdue-notify, backup-scheduler
  - **File:** `deploy.sh L94, update.sh L134, update.ps1 L162; docker-compose.yml L126-197`
  - **Bukti:** Ketiga script mendefinisikan SIEM_WORKER_SERVICES=(syslog-receiver siem-parser siem-rules siem-alerts siem-retention) dan hanya `up -d` kelima itu. docker-compose.yml mendefinisikan 9 service stateless termasuk siem-ai, siem-snapshot, incidents-overdue-notify, backup-scheduler. restart: always/unless-stopped tidak meng-create ulang container saat image tag berubah.
  - **Dampak:** Server baru: worker AI, snapshot, notifier overdue, dan SATU-SATUNYA backup DB otomatis tidak pernah jalan — backup diam-diam tidak pernah terjadi. Saat update, 4 service itu menjalankan image lama selamanya (kode basi tiap deploy).
  - **Saran:** Tambahkan siem-ai siem-snapshot incidents-overdue-notify backup-scheduler ke SIEM_WORKER_SERVICES di ketiga script (dan $statelessServices di update.ps1).

- [ ] **#15 · HIGH · bug · ui-build** — Split-brain env file: compose membaca .env, deploy.sh hanya menulis .env.production
  - **File:** `docker-compose.yml L24-25; deploy.sh L104-147; update.sh L23; .env.example.production L4-5`
  - **Bukti:** Commit 471a1ec mengubah compose ke env_file: .env, tapi deploy.sh tetap membuat/mengisi .env.production dan memakai --env-file .env.production (interpolasi saja). Env runtime container datang dari env_file: .env yang tak pernah dibuat/deploy.sh update. DB inisialisasi POSTGRES_PASSWORD dari .env.production, app membaca DB_PASSWORD dari .env — jika berbeda, app gagal autentikasi. update.sh default ENV_FILE=.env, komentar deploy.sh sendiri bilang .env.production.
  - **Dampak:** Deploy pertama di server bersih gagal atau memecah kredensial antara inisialisasi DB dan runtime app; deploy ulang membuat ulang password di file yang tidak dibaca siapa pun. Jalan hanya karena operator manual memelihara .env yang kebetulan cocok.
  - **Saran:** Satu file (mis. .env) untuk env_file compose dan ditulis deploy.sh; perbaiki komentar header template.

### Band SEDANG — 37 temuan

- [ ] **#16 · MEDIUM · bug · telegram-messaging** — SIEM alert deep-link hardcodes ?severity=High even when the triggering finding is Critical or Medium
  - **File:** `lib/siem/alerts.ts:26; actions/siem-findings.ts:28`
  - **Bukti:** The alert template line 26 is 'Open: [Open in SIEM](${input.baseUrl}/admin/siem/findings?severity=High)' — severity is hardcoded. The findings list filters with exact match eq(siemFindings.severity, filters.severity).
  - **Dampak:** When a Critical (or Medium) finding triggers the alert, the link opens a list filtered to High only, which does NOT contain the finding that prompted the alert — the deep link is actively misleading about the highest-urgency finding.
  - **Saran:** Interpolate the real severity into the query (?severity=${input.severity}), or deep-link to a per-finding detail view if one exists.

- [ ] **#17 · MEDIUM · bug · telegram-messaging** — APP_URL override never takes effect: stored DB login host is prioritized despite the documented env override
  - **File:** `lib/notification-url.ts:32`
  - **Bukti:** 'return secureOrigin(stored || process.env.APP_URL || host || "localhost:3000")' — the comment states 'APP_URL env overrides when a public domain exists and login host is an internal IP', but stored (the last login host, typically the internal IP captured by actions/auth.ts:163-166) is checked before APP_URL, so APP_URL is unreachable whenever any stored value exists.
  - **Dampak:** If the operator last logged in via the internal IP, every Telegram deep link points to that internal IP and is unreachable for on-call recipients outside the LAN — exactly the failure the env override was designed to prevent.
  - **Saran:** Give the operator-controlled env precedence: secureOrigin(process.env.APP_URL || stored || host || 'localhost:3000') and update the base-origin/notification-url tests to document the priority.

- [ ] **#18 · MEDIUM · bug · telegram-messaging** — secureOrigin forces https:// on plain-IP hosts, producing dead links on LAN/plain-HTTP deployments
  - **File:** `lib/base-origin.ts:7`
  - **Bukti:** 'return `${/localhost/i.test(base) ? "http" : "https"}://${base}`' — only localhost is treated as HTTP; any IP yields https (pinned by lib/base-origin.test.ts:8 expecting https://192.168.1.10:3000). The 0028 migration comment explicitly contemplates the 'login host is an internal IP' scenario, and docker-compose maps the app on port 3001 with no TLS.
  - **Dampak:** An operator reaching http://192.168.1.10:3001 gets alert links to https://192.168.1.10:3001, which fail TLS (or connect nowhere) — deep links are dead for the primary on-prem use case.
  - **Saran:** Infer the scheme from the current request (http vs https) instead of assuming, or accept an explicit APP_URL with scheme (see the APP_URL priority finding) and only default to https for external domains.

- [ ] **#19 · MEDIUM · bug · telegram-messaging** — SIEM alert messages are sent completely unescaped: user content can garble formatting or break the deep link
  - **File:** `lib/siem/alerts.ts:17-30; lib/siem/redaction.ts`
  - **Bukti:** alertMessage interpolates raw title, summary, deviceName, sourceIp and passes them only through redactSensitiveText, which masks secrets but never escapes Markdown metacharacters. Legacy Markdown parses _, *, backtick, [; a stray '[' in a finding title earlier in the message can combine with the later '](' of the [Open in SIEM] link and corrupt link parsing.
  - **Dampak:** Messages arrive with spurious bold/italic/link formatting from device names or titles (e.g. 'fw-01_v2', 'Port [idle]'), and in the worst case the SIEM link is not clickable or the URL leaks as prose.
  - **Saran:** Escape entity-supplied fields with a Markdown-escape step (mirroring renderTelegramTemplate) while leaving the generated link intact, or switch to parse_mode HTML with an HTML escaper plus an <a> anchor.

- [ ] **#20 · MEDIUM · bug · telegram-messaging** — Failed SIEM alerts are permanently dropped: no re-queue after 3 fast retries, and the queue dedupe treats failed rows as delivered
  - **File:** `lib/siem/alerts.ts:138,164,211-216; scripts/siem-alert-worker.ts:8`
  - **Bukti:** The queue flips status to 'failed' after retryCount >= 3 (lines 211-216); sendPendingSiemAlerts only selects status='pending' (line 164). The dedupe (line 138) checks 'finding.alerts.some(a => a.channel===channel && a.recipient===recipient)' with no status filter, so a failed row blocks re-queue forever — even after a worker restart. Retries fire in back-to-back ~15s ticks with no backoff.
  - **Dampak:** Any Telegram outage longer than ~45s at queue time permanently drops those alerts with no dead-letter, re-queue, or subsequent retry — a monitoring alert pipeline silently losing the alert it exists to deliver.
  - **Saran:** Exclude status='failed' rows from the dedupe (or filter by status in the queue query), and add exponential backoff / nextAttemptAt so a transient outage is retried across a wider window.

- [ ] **#21 · MEDIUM · incomplete · telegram-messaging** — Overdue-incident notifications ignore the multi-recipient table, severity filters, and deep links
  - **File:** `scripts/notify-overdue-incidents.ts:20,34-37`
  - **Bukti:** Line 20 selects only legacy 'chatId: sites.telegramChatId', and lines 34-37 build '*Incident Overdue*\nSite: ${siteName}\n#${id} ${title}' with no '[link](url)'. Every other telegram path (actions/checklist.ts:146, actions/incidents.ts:133, lib/siem/alerts.ts:37) resolves recipients via siteTelegramChatIds with severity filters.
  - **Dampak:** Sites that migrated to multi-recipient (or cleared the legacy field) receive no overdue notifications at all, and recipients that do get one cannot click through to the incident — inconsistent with the rest of the feature.
  - **Saran:** Reuse resolveIncidentRecipients-style resolution and append '[#${id} ${title}](${baseUrl}/admin/incidents/${id})' exactly like notifyCriticalIncidents.

- [ ] **#22 · MEDIUM · bug · telegram-messaging** — Combined checklist alert message can exceed Telegram's 4096-char limit and drop the whole batch silently
  - **File:** `actions/checklist.ts:196,200; lib/telegram.ts:100-105`
  - **Bukti:** 'const message = messages.join("\n\n---\n\n")' sends to each recipient as ONE payload; sendTelegramAlert has no size guard or chunking. Telegram Bot API rejects messages over 4096 chars with HTTP 400, and dispatch is fire-and-forget with only .catch(console.error).
  - **Dampak:** A large checklist with many NOT-OK devices, or a near-4000-char custom template (maxLength 4000 in settings-form.tsx), yields an over-limit payload and none of the batch is delivered — invisible to the operator.
  - **Saran:** Chunk joined messages to <= 4000 chars (split on device blocks) and send one message per chunk, or send per-incident messages; log a warning on truncation.

- [ ] **#23 · MEDIUM · bug · incidents-checklist-fieldaudit** — updateChecklist deletes/re-inserts items, orphaning linked incidents and never creating incidents for newly flagged devices
  - **File:** `actions/checklist.ts:285-338; db/schema.ts:226`
  - **Bukti:** The edit path runs db.delete(checklistItems).where(eq(checklistItems.entryId, entryId)) then re-inserts with fresh ids. incidents.checklistItemId has onDelete: 'set null', so every incident auto-created from an edited entry loses its source link. updateChecklist never calls createIncidentsForChecklistItems, so a device flipped to NOT OK during edit gets no incident, and a device flipped back to OK leaves its Open incident still open with its link severed.
  - **Dampak:** After any checklist edit, the audit-to-incident follow-up silently stops working: new NOT OK items produce no incidents, and existing incidents become unlinked from the checklist item (unique index accepts multiple NULLs), degrading reporting and the recurring-incident dedupe.
  - **Saran:** Reconcile incidents in updateChecklist: create incidents for newly NOT OK re-inserted items, and resolve/cancel incidents whose items changed to OK; alternatively keep original item rows instead of delete-and-reinsert.

- [ ] **#24 · MEDIUM · misscode · incidents-checklist-fieldaudit** — changeIncidentStatus allows Open->Verified and reopening preserves stale resolution fields (incomplete status-enum handling)
  - **File:** `lib/incidents.ts:69-72; actions/incidents.ts:485-498`
  - **Bukti:** canTransitionIncidentStatus returns true for every transition except Verified->Open for admins; actions/incidents.ts:485-487 only require resolutionCategory/resolutionAction when next === 'Resolved' — nothing is enforced for next === 'Verified' — so an admin can move an Open incident straight to Verified, writing verifiedBy/verifiedAt with null resolution fields. Reopening Verified/Resolved->Open keeps existing.resolutionCategory/resolvedById/resolvedAt on a now-Open incident.
  - **Dampak:** Incidents can reach the terminal Verified state without ever being resolved (no resolution data, no resolvedAt), corrupting the status model; reopened incidents retain stale 'resolved' metadata that will mislead any future report keying off resolvedAt/resolutionCategory.
  - **Saran:** Require resolution fields before allowing Verified (or constrain the admin Verified path to go through Resolved); clear resolutionCategory/Action/resolvedById/resolvedAt when reopening an incident to Open.

- [ ] **#25 · MEDIUM · bug · cross-cutting** — getAuditLogs builds a WHERE clause but never applies it to either query — latent bug; currently dead code because the page implements its own correct query
  - **File:** `lib/audit.ts:127-152`
  - **Bukti:** Verified: lib/audit.ts:134-136 computes whereClause from entity/action/search conditions, but the select (138-143) and the COUNT(*) (145-147) query auditLogs with no .where() — the clause is never attached. The admin audit page (app/[locale]/(dashboard)/admin/audit-log/page.tsx:36-50) implements its own correct filtering with .where(whereClause) applied to both queries, so the function is currently dead code.
  - **Dampak:** Latent bug: the moment anyone wires the admin UI to getAuditLogs, entity/action/search filters and the total count will silently report the full unfiltered table, breaking pagination totals and filter UX without any error.
  - **Saran:** Apply .where(whereClause) to both the select and the count query (gate with conditions.length>0 ? and(...conditions) : undefined), or delete the function in favor of the page-local query; add a unit test asserting filtered results and totals.

- [ ] **#26 · MEDIUM · bug · device-groups** — Create/update/delete in device-groups are non-atomic — group row persisted before membership sync; failure leaves orphan/partial state
  - **File:** `actions/device-groups.ts:86-104 (addDeviceGroup), 124-140 (updateDeviceGroup), 146-158 (deleteDeviceGroup)`
  - **Bukti:** addDeviceGroup inserts the device_groups row (87-92) THEN calls bindGroup (94) — if bindGroup throws (which it always does when owners are assigned, see CRITICAL finding; also on FK violations), the catch returns an error but the group row stays committed. updateDeviceGroup updates name/color first, then bindGroup — membership failure leaves a partially-updated group. deleteDeviceGroup deletes the row first and calls detachOwners after (152-155), so a detach failure leaves the group gone but users still referencing a dangling group id. No db.transaction anywhere.
  - **Dampak:** Users see 'Gagal menyimpan grup.' but the group actually exists (orphan with no memberships); resubmitting creates duplicate groups. Deletes can leave stale group ids in users.responsible_for_groups.
  - **Saran:** Wrap each mutation in db.transaction(...) so the group row and device_pics/users rewrites commit or roll back together; detach owners before deleting the group row.

- [ ] **#27 · MEDIUM · bug · device-groups** — bindGroup does not validate deviceIds/ownerIds belong to the group's site — cross-site binding possible, device_pics.siteId diverges from devices.siteId
  - **File:** `actions/device-groups.ts:83-84,121-122,167-185; db/schema.ts:190-199; drizzle/0029_devices_pics.sql:35-46`
  - **Bukti:** bindGroup takes deviceIds straight from formData and inserts { deviceId, groupId, siteId } into device_pics with siteId = auth.activeSiteId without checking devices.siteId matches; ownerIds are never checked against the site either. device_pics has denormalized site_id with only individual FKs (no composite constraint ensuring device.site_id = group.site_id = device_pics.site_id); the unique index is (device_id, group_id) only.
  - **Dampak:** Cross-site data integrity corruption: a group can show devices that belong to another site, producing device_pics rows whose site_id disagrees with the device's actual site_id; any downstream query joining device_pics->devices on siteId silently disagrees, and users from other sites (or deactivated ones) can be attached as PICs with no validation.
  - **Saran:** Before inserting, select devices where inArray(devices.id, deviceIds) AND eq(devices.siteId, siteId) and only bind the returned ids (reject or ignore mismatches); validate ownerIds have a userSites row for the site; consider a composite FK/trigger or a unique index on (site_id, device_id, group_id) to make the denormalization auditable.

- [ ] **#28 · MEDIUM · bug · device-groups** — PIC picker exposes ALL users: no site filter, no isActive filter; responsible_for_groups is stored globally, not per-site
  - **File:** `actions/device-groups.ts:199-203 (getGroupUsers), 47-58 (getDeviceGroups owner scan), 205-210 (getGroupDevices)`
  - **Bukti:** getGroupUsers selects every user in the table regardless of userSites membership and regardless of users.isActive; bindGroup assigns any of them as owner via the global users.responsible_for_groups column. getGroupDevices does not filter devices.isActive either.
  - **Dampak:** Users of other sites are visible in the PIC picker (cross-site info exposure); deactivated users remain assignable; PICs may be assigned to groups of sites they cannot access, so the 'PIC inherits the group' promise fails in practice.
  - **Saran:** Join userSites and filter to users with access to auth.activeSiteId (superadmin sees all), filter eq(users.isActive, true); consider making responsible_for_groups site-scoped or validating on assignment that the user has a userSites row for the site.

- [ ] **#29 · MEDIUM · incomplete · device-groups** — Route-level RBAC gap: /admin/device-groups page only checks verifySession — staff users see the admin shell instead of being redirected
  - **File:** `app/[locale]/(dashboard)/admin/device-groups/page.tsx:10-14`
  - **Bukti:** The page calls only verifySession() and redirects to /login when absent; it never checks hasAdminAccess / admin role. Sibling pages enforce it (e.g. brands/page.tsx redirects non-admin to /checklist). Here a staff user gets the full admin UI shell: getDeviceGroups returns [] silently, but the 'New Group' button renders and any submit returns a bare 'Unauthorized' message.
  - **Dampak:** Non-admin staff can browse an admin-management page, see a '0 groups' UI, and only discover failure after attempting a mutation — inconsistent with the rest of the admin area and confusing.
  - **Saran:** Add the same !["admin","superadmin"].includes(session.role) redirect as sibling pages (to /checklist) before rendering.

- [ ] **#30 · MEDIUM · incomplete · device-groups** — isActive status is dead in device-groups: the Status column renders Active/Inactive but no action ever writes isActive, and the list does not filter inactive groups
  - **File:** `components/admin/device-groups-client.tsx:106-112; actions/device-groups.ts:15-19 (groupSchema)`
  - **Bukti:** groupSchema (name/description/color only) has no isActive field; addDeviceGroup/updateDeviceGroup never set it; the client StatusBadge reads group.isActive which can only ever be the schema default true. There is no toggle anywhere. getDeviceGroups returns inactive groups as if active.
  - **Dampak:** The Status column is misleading UI — a badge that can never show 'Inactive' — and there is no mechanism to deactivate a group (e.g. stop it being offered on new device forms).
  - **Saran:** Either add an isActive checkbox to the form + set it in create/update + filter the list, or remove the isActive column and Status badge entirely.

- [ ] **#31 · MEDIUM · misscode · device-groups** — Missing Drizzle relations for deviceGroups and devicePics (and orphaned siemSettings inverse relation) — relational query API unavailable, actions fall back to full-table scans
  - **File:** `db/schema.ts:291-386 (RELATIONS block), 905-911 (siemSettingsRelations)`
  - **Bukti:** The schema defines 24 relations but none for device_groups or device_pics: sitesRelations (293-305) has no deviceGroups, devicesRelations (362-385) has no devicePics, usersRelations (314-321) has no group ownership. db.query.deviceGroups.findMany({ with: ... }) is unavailable, so the actions work around it with manual queries and a full-table users scan (getDeviceGroups/detachOwners — an N+1 pattern). siemSettingsRelations declares relationName 'siemSettingsSite' with no matching inverse.
  - **Dampak:** The relational query API silently cannot be used for the new tables (TS/runtime error if attempted); future consumers must re-implement the same manual joins, and the full-table users scan is already an N+1 pattern better relations would avoid.
  - **Saran:** Add deviceGroupsRelations (site, devicePics, owners via users.responsible_for_groups), devicePicsRelations (device, group, site), extend sitesRelations/devicesRelations/usersRelations accordingly, and add the missing siemSettings inverse to sitesRelations or remove the orphaned relationName.

- [ ] **#32 · MEDIUM · bug · network-rack-management-faceplate** — 0.5U option in device forms is unsupported by the DB integer column: choosing it always fails to save with a generic error
  - **File:** `components/admin/add-device-form.tsx:223; edit-device-form.tsx:254; db/schema.ts:175; actions/master-data.ts (deviceSchema)`
  - **Bukti:** Both forms offer '<option value="0.5">0.5U</option>', but uHeight is integer('u_height').default(1) and deviceSchema coerces with z.preprocess(Number) without an integer check, so 0.5 passes validation and fails at the Postgres integer column, surfacing only the generic 'Terjadi gangguan sistem' message. If 0.5 were ever stored, rackRangesOverlap and the occupiedU loop would produce fractional ranges.
  - **Dampak:** Selecting 0.5U always errors on save with a misleading generic message; the option is dead UI in both add and edit forms.
  - **Saran:** Remove the 0.5U option, or change u_height to numeric and handle half-U occupancy/rendering consistently (occupiedU, collision ranges, layout grid).

- [ ] **#33 · MEDIUM · misscode · network-rack-management-faceplate** — racks.name has no unique constraint in the DB while app code assumes one; duplicate/case-variant names bypass collision checks
  - **File:** `drizzle/0000_adorable_jackal.sql:111-120; actions/rack-management.ts:116-118,166-168`
  - **Bukti:** The racks table has no unique index on name or (site_id, name) and no later migration adds one, yet addRack/updateRack catch 'UNIQUE constraint' errors and return 'Nama rak ini sudah terdaftar'. checkRackCollision and getOccupiedSlots match by eq(devices.rackName, rackName) case-sensitively while getRackLayout merges racks by name.toLowerCase() — so 'Rack A' and 'rack A' render as one rack but collision checks treat them as different, letting devices overlap undetected; update-position's findFirst by name picks an arbitrary duplicate row for zone propagation.
  - **Dampak:** Duplicate rack names are permitted, enabling undetected device overlaps in the visual rack, arbitrary zone lookups, and a dedup error path that never fires.
  - **Saran:** Add a unique index on (site_id, lower(name)) or (site_id, name); normalize case in all rack lookups (collision check, occupied slots, layout map) so checks match the rendered layout.

- [ ] **#34 · MEDIUM · bug · network-rack-management-faceplate** — updatePort destroys an existing bidirectional port link whenever the edit payload omits connectedToPortId
  - **File:** `actions/network.ts:436-450 (updatePort), 137-153 (addPort auto-link); components/admin/edit-port-modal.tsx:63-76`
  - **Bukti:** updatePort runs `if (oldConn !== newConn)` where newConn = data.connectedToPortId; edit-port-modal never sends connectedToPortId, so newConn is undefined and `null !== undefined` is always true: the branch unlinks the remote port's back-pointer and then skips relinking. Additionally addPort's auto-link fetches the new id with orderBy(desc(id)).limit(1) instead of INSERT RETURNING (racy under concurrent inserts) and never unlinks the target port's previous back-link, leaving stale one-directional pairs.
  - **Dampak:** Any port that has connectedToPortId loses its remote pair the moment it is edited through the UI; topology becomes one-directional/stale, and concurrent port creation can back-link the wrong port id.
  - **Saran:** Include connectedToPortId in the edit modal payload (or read it from the stored row) and only unlink when the new value differs from the stored value; use .returning({ id }) on insert; unlink the target's previous back-link in addPort.

- [ ] **#35 · MEDIUM · incomplete · network-rack-management-faceplate** — portIndex slot override is unbounded server-side: out-of-range slots persist silently as permanent 'Unmapped'
  - **File:** `actions/network.ts:554 (updatePortSlot), addPort/updatePort; components/admin/device-faceplate.tsx:70-85; drizzle/0030_device_faceplate.sql:16`
  - **Bukti:** updatePortSlot accepts any integer >= 1 and addPort/updatePort forward portIndex unvalidated; only the UnplacedPortRow client widget bounds input to maxSlot, while edit-port-modal and add-port-form inputs have min=1 with no max. The DB column is a plain integer with no CHECK. resolveSlotNumber returns null for overrides > portCount+uplinkCount, so a typo like 999 stores forever and the port never appears on the diagram, with no server-side explanation.
  - **Dampak:** A typo'd slot value silently persists in the DB; the port stays unmapped, and the table/diagram both report failure without telling the admin the stored value is out of range.
  - **Saran:** Validate portIndex against the device's faceplate config (portCount + uplinkCount) inside updatePortSlot/addPort/updatePort, or add a DB CHECK constraint; return a clear error instead of storing it.

- [ ] **#36 · MEDIUM · incomplete · network-rack-management-faceplate** — parsePortIndex maps subinterfaces, SVIs and bundles to wrong slots silently (last numeric group wins)
  - **File:** `lib/faceplate.ts:138-144`
  - **Bukti:** parsePortIndex takes the LAST numeric group: 'Gi1/0/2.10' -> 10, 'Vlan10' -> 10, 'Port-Channel1' -> 1, 'TenGigabitEthernet1/1/4' -> 4. A router subinterface 'Gi1/0/2.10' is therefore placed on slot 10 (or evicted into unplaced only by luck of a collision) instead of slot 2, and because the derived number stays in range it is NOT surfaced in the unplaced list — contradicting commit 01d52de's 'explainable and correct' claim.
  - **Dampak:** Router/switch ports named as subinterfaces, VLAN SVIs or bundles get attributed to the wrong physical slot on the diagram and in the PDF export with no warning.
  - **Saran:** Strip subinterface suffixes before deriving (e.g. split on '.', skip Vlan*/Port-Channel* prefixes, or require the numeric token to be the whole last path segment) and route unparsable names to the unplaced list.

- [ ] **#37 · MEDIUM · tech_debt · auth-admin-routing-i18n** — components/ui/navbar.tsx is dead code — never imported, yet still modified and maintained with voided i18n calls
  - **File:** `components/ui/navbar.tsx`
  - **Bukti:** Repo-wide grep finds zero imports of this component outside docs (docs/superpowers/plans/2026-05-19-ui-ux-rework.md: 'Keep components/ui/navbar.tsx until migration is complete, then remove or leave unused only if no imports remain'). The real nav is AppShell (components/ui/app-shell.tsx). The file is in the current git status as Modified (receiving SIEM / device-groups additions), and its only i18n usage is `const t = useTranslations("Nav"); const tAdmin = useTranslations("AdminMenu"); void t; void tAdmin;` — translations fetched and discarded.
  - **Dampak:** ~275 lines of dead, actively-edited component: any work here (locale switching, active states, i18n cleanup) is invisible to users and duplicated maintenance; the voided useTranslations calls mislead new contributors into editing the wrong navbar.
  - **Saran:** Delete components/ui/navbar.tsx since AppShell superseded it, or actually wire it into a layout if a top navbar is intended; if kept, remove the void t / void tAdmin dead i18n calls.

- [ ] **#38 · MEDIUM · incomplete · auth-admin-routing-i18n** — I18N effectively non-functional: no locale switcher, UI hardcoded English, mixed-language messages, unreachable 'en' locale
  - **File:** `i18n/routing.ts; app/[locale]/login/page.tsx; lib/ui/navigation.ts`
  - **Bukti:** routing.ts declares locales ['en','id'], default 'id', as-needed prefix; messages/en.json + id.json define Login/Nav/AdminMenu. But the only component that meaningfully calls useTranslations is the login page; AppShell + navigation + admin pages are hardcoded English, and there is NO UI to switch locale (no useLocale/LocaleSwitcher/next-intl link anywhere in components). Server-action error strings are hardcoded Indonesian regardless of active locale (actions/auth.ts 'Username atau password salah.', actions/master-data.ts Indonesian messages) shown to /en users.
  - **Dampak:** The en locale is unreachable without URL manipulation and content is English-only; the id locale shows Indonesian only on the login page while action errors return Indonesian strings to English users — a configured but practically absent language feature.
  - **Saran:** Add a locale switcher in AppShell using next-intl's Link/useRouter (locale-prefixed), migrate AppShell navigation + admin labels to useTranslations, and localize server-action messages (return keys or pick locale via requestLocale). If bilingual is not a goal, drop the en locale + messages to reduce surface.

- [ ] **#39 · MEDIUM · incomplete · auth-admin-routing-i18n** — No React error boundaries anywhere in app/: DB failure on the admin dashboard = whole-page 500 with no recovery UI
  - **File:** `app/[locale]/(dashboard)/admin/page.tsx:66-71; app/ (no error.tsx/global-error.tsx/not-found.tsx/loading.tsx)`
  - **Bukti:** AdminPage awaits getCategories(), getDevices(), getBrands(), getLocations() with no try/catch, and only getLocations catches internally. Glob for app/**/{error,global-error,not-found,loading}.tsx returns no files. All page-level failure handling is ad-hoc inside server actions returning {message} shapes; uncaught render/DB errors surface Next's default 500 page.
  - **Dampak:** No graceful error/retry state on the main admin dashboard; during the documented deploy flows (schema migrations, restarts) the admin console can become a hard 500 with no recovery UI, and DB outages produce generic developer-facing pages in production.
  - **Saran:** Add error.tsx/global-error.tsx/not-found.tsx at the (dashboard) or admin route-group level with a retry affordance (plus loading.tsx for slow queries), and fetch the four datasets in parallel with per-call catches (or Promise.allSettled) so one failing source degrades inline.

- [ ] **#40 · MEDIUM · bug · auth-admin-routing-i18n** — Audit-log page redirects unauthorized users to non-existent /dashboard (404)
  - **File:** `app/[locale]/(dashboard)/admin/audit-log/page.tsx:19-21`
  - **Bukti:** Lines 19-21: `if (!session || !["admin","superadmin"].includes(session.role)) redirect("/dashboard")`. No /dashboard route exists under app/[locale]/(dashboard) — only about, admin, checklist, grid, profile, report.
  - **Dampak:** Staff/logged-out users hitting /admin/audit-log are sent to a 404 instead of a graceful redirect; broken link navigation in the auth flow.
  - **Saran:** Change to redirect("/checklist") — consistent with sibling pages like brand/category/location.

- [ ] **#41 · MEDIUM · tech_debt · database-schema-migrations** — 0016 partition migration drops syslog_events FKs (raw_event_id, site_id, device_id, source_id) and never restores them; schema.ts still declares them
  - **File:** `drizzle/0016_si_partitioned.sql:89-102,282-285; db/schema.ts:572,584-586`
  - **Bukti:** 0016 drops syslog_events_raw_event_id_syslog_events_raw_id_fk; the partitioned twins are created without ANY foreign keys and without site_id on syslog_events_raw (site_id only added later by 0024); the file states the raw_event_id FK is 'intentionally not recreated — application layer maintains that reference'. schema.ts still declares rawEventId/siteId/deviceId/sourceId as FK references. PostgreSQL forbids FKs referencing a partitioned table, so the raw_event_id FK can never be re-added; the DB PK is composite (id, received_at) while schema declares PK on id alone.
  - **Dampak:** Schema/DB constraint drift on the two hottest SIEM tables: no FK integrity for syslog_events, and any db:push/generate+apply attempt to reconcile fails on the raw_event_id FK. Orphaned events with dangling raw_event_id/source_id are possible and invisible to the ORM layer.
  - **Saran:** Align schema.ts with the partitioned reality: mark rawEventId as a plain integer with a comment (no .references()), and add a later migration recreating the legal FKs (syslog_events.site_id->sites, device_id->devices, source_id->syslog_sources) that 0016 dropped — referencing-side FKs ARE supported on partitioned tables.

- [ ] **#42 · MEDIUM · incomplete · database-schema-migrations** — 0024 backfill falls back to min active site id, then 0025 locks the (possibly wrong) tenancy with NOT NULL
  - **File:** `drizzle/0024_siem_per_site.sql:46-55; drizzle/0025_siem_per_site_constraints.sql:43-49`
  - **Bukti:** 0024 backfills NULL site_ids with `(SELECT min(id) FROM sites WHERE is_active = true)` for syslog_events_raw rows with unmatched source_ip, quarantine rows with missing original_event_id, findings with empty sample_event_ids, and all siem_rules/siem_settings rows; 0025 then ALTERs those columns SET NOT NULL. syslog_events_raw.site_id is the only one kept nullable.
  - **Dampak:** On upgrade, SIEM events/findings whose source mapping could not be resolved get permanently attributed to the oldest active site; after 0025 the mis-assignment cannot be reset to NULL, so data silently lands in the wrong site's dashboards, retention jobs, and alert routing with no way to distinguish it from genuinely-site-1 data.
  - **Saran:** Before making site_id NOT NULL, add an explicit remediation path (log/flag fallback-assigned rows, or leave columns nullable until a manual review pass); at minimum document the fallback semantics in the schema comments as done for syslog_events_raw.

- [ ] **#43 · MEDIUM · bug · cross-cutting** — Test suite is RED on main: 11 failures in 4 files (auth x7, incidents x1, update-scripts x2, deploy-secrets x1)
  - **File:** `actions/auth.test.ts; lib/incidents.test.ts:48; scripts/update-scripts.test.ts; deploy-secrets.test.ts`
  - **Bukti:** npx vitest run: Test Files 4 failed | 72 passed (76), Tests 11 failed | 409 passed (420). auth.test.ts failures: '`headers` was called outside a request scope' — login() now calls (await headers()).get('host') (actions/auth.ts:163-170) with next/headers unmocked. lib/incidents.test.ts:48 expects allowedNextStatuses({isAdmin:false,isAssignee:true,current:'Open'}) to equal ['In Progress'] but code (lib/incidents.ts:67 early-return current===next) returns ['Open','In Progress']. update-scripts tests expect 'drizzle-kit push' but update scripts contain 'npm run db:migrate'; deploy-secrets regenerate=always assertion fails.
  - **Dampak:** CI/main branch is failing; the incidents failure also exposes a real behavior contradiction (staff see a no-op 'Open' transition button), and regressions from the recent login change went uncaught.
  - **Saran:** Mock next/headers in auth.test.ts (or make rememberNotificationBaseUrl injectable); decide intent for the same-status transition (remove the early return in canTransitionIncidentStatus or update the test); refresh update-scripts/deploy-secrets tests to the deliberate db:migrate flow; add a CI gate so the suite must pass before merge.

- [ ] **#44 · MEDIUM · bug · cross-cutting** — submitChecklist inserts checklist items for deviceIds from any site — no site-scoping at the trust boundary
  - **File:** `actions/checklist.ts:82-108; actions/incidents.ts:310-316`
  - **Bukti:** formData.getAll('deviceId') is parsed and inserted into checklist_items with entryId/status/remarks without verifying devices.siteId === auth.activeSiteId. Only the downstream createIncidentsForChecklistItems validates device site membership (and silently skips mismatches).
  - **Dampak:** A logged-in user can submit a checklist that records entries against another site's devices (cross-site data pollution: audit history attributed to the wrong site, device stats skewed); the incident sub-flow silently drops those devices, so results diverge between checklist records and incident records.
  - **Saran:** Validate all deviceIds against devices.siteId = activeSiteId (single query with inArray) and reject or drop out-of-site ids before inserting; add a server-action test for cross-site submission.

- [ ] **#45 · MEDIUM · incomplete · cross-cutting** — Login rate limit bypassable: trusts client-supplied X-Forwarded-For and uses per-process in-memory buckets
  - **File:** `middleware.ts:49-52; lib/rate-limit.ts:22-60; actions/auth.ts:74-98`
  - **Bukti:** ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() — the first XFF element is attacker-controlled unless the proxy overwrites it. lib/rate-limit.ts keeps buckets in module memory; the file's own comment notes each worker has its own bucket (ceiling max * numWorkers).
  - **Dampak:** An attacker can rotate XFF values (or hit multiple workers) to bypass the 5/min login rate limit. Account lockout (5 fails / 15 min) remains the backstop, so impact is limited to extra password-guessing attempts between lockouts.
  - **Saran:** Read the client IP from a proxy-set header configured to overwrite (or X-Real-IP set by the reverse proxy) and document the proxy requirement; consider a shared store (Redis) for multi-worker deployments.

- [ ] **#46 · MEDIUM · incomplete · cross-cutting** — Env validation schema covers only a subset — TELEGRAM_BOT_TOKEN, APP_URL, SECURE_COOKIES, SIEM_AI_*, DB_* bypass zod and default insecurely
  - **File:** `lib/env.ts:12-52; lib/telegram.ts:55; lib/notification-url.ts:32; lib/session.ts:51; lib/database-url.ts:8-22; actions/siem-ai.ts:24-32`
  - **Bukti:** lib/env.ts validates only SESSION_SECRET, UPLOAD_DIR, MAX_FILE_SIZE, DATABASE_URL, AWS_*, AI_KEY_ENCRYPTION_SECRET. Raw process.env reads bypass it: TELEGRAM_BOT_TOKEN, APP_URL, SECURE_COOKIES (defaults to false -> cookie not marked Secure), DB_HOST/DB_USER/DB_PASSWORD/DB_NAME with dev defaults 'postgres'/'postgres'/'dccheck', SIEM_AI_*.
  - **Dampak:** No fail-fast validation or documentation contract for credentials the app actually depends on; SECURE_COOKIES off by default means session cookies can transit plaintext HTTP in misconfigured deployments (session hijack); two sources of truth (zod cache vs process.env) drift.
  - **Saran:** Extend envSchema with TELEGRAM_BOT_TOKEN, APP_URL, SECURE_COOKIES, SIEM_AI_* and DB_* fields (with .optional() where legit), route all reads through getEnv(), and force secure cookies when APP_URL is https or NODE_ENV=production behind a proxy.

- [ ] **#47 · MEDIUM · tech_debt · cross-cutting** — MAX_FILE_SIZE/UPLOAD_DIR env config is dead; no per-file size cap and full in-memory buffering — disk/memory exhaustion by any authenticated user
  - **File:** `lib/env.ts:32-33; next.config.ts:9-13; lib/upload.ts:9`
  - **Bukti:** MAX_FILE_SIZE (5MB) and UPLOAD_DIR are never consumed anywhere; next.config.ts sets serverActions.bodySizeLimit '10mb' and upload paths read file.arrayBuffer() into memory and write to public/uploads with no size check.
  - **Dampak:** Any authenticated user can repeatedly upload ~10MB files (checklist/incident photos) to fill the disk and spike memory; the declared 5MB limit is silently ignored.
  - **Saran:** Enforce MAX_FILE_SIZE per file (and per request), check remaining disk space, and stream to disk instead of buffering; delete the dead UPLOAD_DIR/MAX_FILE_SIZE config or wire it in.

- [ ] **#48 · MEDIUM · incomplete · ui-build** — Kotak pencarian di header aktif tidak berfungsi (affordance palsu)
  - **File:** `components/ui/app-shell.tsx L215-222`
  - **Bukti:** <input type="search" placeholder="Search device or incident..."> tanpa state, onChange, form, atau submit handler. Navbar lama punya salinan kedua yang identik. Keduanya render-only.
  - **Dampak:** Pengguna mengetik di pencarian yang tidak pernah melakukan apa pun — masalah kejujuran antarmuka di setiap halaman dashboard.
  - **Saran:** Hubungkan ke /report?q= atau hapus sepenuhnya.

- [ ] **#49 · MEDIUM · bug · ui-build** — Shim globals.css light-mode meng-override .text-white global — tombol putih-di-atas-warna rusak kontrasnya
  - **File:** `app/globals.css L231`
  - **Bukti:** `html:not(.dark) .text-white { color: var(--color-foreground); }` mengubah text-white jadi nyaris hitam #0f172a di light mode. Komponen yang sah memakai putih-di-atas-warna ikut gelap: pagination.tsx L104 (bg-blue-600 text-white), site-telegram-chats.tsx L176, edit-checklist-form.tsx L185, sites/page.tsx L174 (bg-primary text-white). Kontras turun ke ~3:1 (gagal WCAG AA).
  - **Dampak:** Regresi kontras terlihat di halaman admin & pagination saat mode terang; gejala dua sistem token yang berebut (legacy surface/foreground vs ops-*).
  - **Saran:** Perbaiki halaman legacy agar memakai token (text-ops-*, text-white hanya di permukaan yang memang gelap) lalu hapus override global.

- [ ] **#50 · MEDIUM · tech_debt · ui-build** — components/ui/loading-state.tsx mati — hanya direferensikan oleh tesnya sendiri
  - **File:** `components/ui/loading-state.tsx`
  - **Bukti:** Tidak ada impor dari app/** atau components/**; hanya a11y.test.tsx dan ui-states.test.tsx. Tidak ada app/**/loading.tsx yang memakai konvensi loading Next.
  - **Dampak:** Dead code yang hidup karena tesnya sendiri; tidak ada loading UI yang benar-benar tampil di rute mana pun.
  - **Saran:** Hapus, atau pakai di app/**/loading.tsx untuk rute-rute dashboard.

- [ ] **#51 · MEDIUM · incomplete · ui-build** — tsc --noEmit gagal: 19 error di file tes; tidak ada script typecheck atau gate CI
  - **File:** `lib/env.test.ts (13), lib/siem/receiver.test.ts (4), actions/auth.test.ts (1)`
  - **Bukti:** npx tsc --noEmit exit 1: TS2540/TS2704 (process.env.NODE_ENV read-only di @types/node baru), TS2322 (vi.fn mock unknown[] vs array bertipe), TS2556 (spread). tsconfig mencakup **/*.ts. package.json tidak punya script typecheck — npm run check = lint+test+build. npm run build tetap bersih (Turbopack, exit 0, nol warning).
  - **Dampak:** Error hijau di vitest/esbuild tapi merah di IDE dan akan muncul begitu type-checking Next menyentuh file ini; menghambat siapa pun yang ingin menambahkan gate tsc.
  - **Saran:** Tambahkan script `typecheck: tsc --noEmit`; perbaiki 3 file tes (vi.mocked / helper mutasi env).

- [ ] **#52 · MEDIUM · tech_debt · ui-build** — pagination.tsx hardcode URL /report dan tombol first/last tanpa nama aksesibel
  - **File:** `components/ui/pagination.tsx L25, L79-136`
  - **Bukti:** getPageUrl() selalu push /report?... (komponen tidak reusable untuk halaman paginated lain). Tombol first/last icon-only tanpa aria-label maupun title. Masih palet legacy slate/blue-600, bukan token ops-*.
  - **Dampak:** Navigasi salah diam-diam jika di-reuse; screen reader tidak mengumumkan apa pun untuk first/last; inkonsisten visual dengan sistem desain.
  - **Saran:** Terima prop basePath; tambah aria-label "First page"/"Last page"; migrasikan ke token ops.

### Band RENDAH — 31 temuan

- [ ] **#53 · LOW · bug · telegram-messaging** — No timeout/abort on the Telegram fetch: a hung request stalls the entire SIEM alert worker
  - **File:** `lib/telegram.ts:95`
  - **Bukti:** 'await fetch(url, { method: "POST", headers, body })' — no AbortSignal/timeout. The worker scripts/siem-alert-worker.ts:53-75 awaits runSiemAlertWorkerOnce() per tick, and sendPendingSiemAlerts awaits sendTelegramAlert inline (lib/siem/alerts.ts:182).
  - **Dampak:** A black-holed or half-open network connection blocks the alert loop indefinitely (telegram plus queued webhook/email alerts stall behind it) with no reaper.
  - **Saran:** Add 'signal: AbortSignal.timeout(10_000)' to the fetch, and/or enforce a per-alert send timeout in the worker.

- [ ] **#54 · LOW · tech_debt · telegram-messaging** — sendTelegramAlert error path can throw on non-JSON bodies and masks the real Telegram API error
  - **File:** `lib/telegram.ts:107-117`
  - **Bukti:** On !response.ok it does 'await response.json()' — this throws if Telegram returns a non-JSON body (proxy HTML, 429 plain text), which the outer catch then labels 'Network error'. The returned message on any API rejection is the generic 'Gateway rejected request', discarding Telegram's error_data (e.g. 'chat not found', 'message is too long').
  - **Dampak:** Admin test messages and worker failure records only show a vague message, making misconfiguration (wrong chat_id/bot token) very hard to diagnose.
  - **Saran:** Read the body as text, try JSON parse, and propagate error_data.description into the returned message; keep the generic string only as a last-resort.

- [ ] **#55 · LOW · misscode · telegram-messaging** — Client template token chip list omits the incidentLink token (UI/backend token lists drift)
  - **File:** `components/admin/settings-form.tsx:19-38`
  - **Bukti:** telegramTemplateTokens is defined without 'incidentLink', while the server renders it (lib/telegram.ts:24-44 TELEGRAM_ALERT_TEMPLATE_FIELDS includes incidentLink) and the default template relies on it (lib/telegram.ts:7).
  - **Dampak:** Admins editing templates in the UI are never offered the {incidentLink} chip and may unknowingly delete the deep-link line from their custom template; UI and backend token lists drift apart.
  - **Saran:** Add 'incidentLink' to telegramTemplateTokens (and keep the two lists in sync — ideally derive both from a single source).

- [ ] **#56 · LOW · misscode · telegram-messaging** — Submit-checklist Telegram severity mapping is dead code — always 'Medium', so severity-filtered recipients can miss all alerts
  - **File:** `actions/checklist.ts:150-153`
  - **Bukti:** Verified: `alertItems.some((a) => a.status === "NOT OK") ? "Medium" : "Low"` — alertItems only ever receives items where normalizedStatus === 'NOT OK' (lines 111-112), so some() is always true when the branch runs and the 'Low' fallback is unreachable. SEVERITY_RANK (line 19) is declared but never read; the comment claims it maps 'the worst item severity' but no per-item severity is available here.
  - **Dampak:** Every checklist alert is bucketed as 'Medium' for resolveChecklistRecipients, so a siteTelegramChatIds row configured with a severityFilter of only 'Critical' (or 'High') will never receive checklist alerts, even though the flow intends severity-based delivery.
  - **Saran:** Either compute a real per-item severity from the item (e.g. reuse getDefaultIncidentSeverity / incident severity) or remove the dead ternary and document that checklist alerts are always sent as Medium.

- [ ] **#57 · LOW · misscode · telegram-messaging** — Settings test message fabricates a #TEST deep link to incident/1 and uses UTC dates
  - **File:** `actions/settings.ts:285-299`
  - **Bukti:** checkDate uses 'now.toISOString().slice(0,10)' (UTC, not WIB) and incidentLink is '[Open incident #TEST](${baseUrl}/admin/incidents/1)' — label says #TEST but the URL targets incident id 1, which may not exist (404 on click).
  - **Dampak:** The test message can show a wrong date (Jakarta evening skews a day back) and its deep link may 404, undermining its purpose as a smoke test of the real alert template.
  - **Saran:** Reuse formatWibForAlert for the date/time, and only emit a real incident link when a recent incident exists (or label it consistently with the URL).

- [ ] **#58 · LOW · tech_debt · telegram-messaging** — Legacy parse_mode 'Markdown' is deprecated by Telegram and inconsistently rendered
  - **File:** `lib/telegram.ts:103`
  - **Bukti:** sendTelegramAlert sets parse_mode: 'Markdown' (legacy). Telegram has deprecated legacy Markdown for new messages and its support varies across clients; nested link URLs containing characters like '_' or ')' are especially fragile.
  - **Dampak:** Gradual rendering divergence across clients and maintenance debt tied to the 4-char legacy escape set; also the root enabler of the link-breaking escape bug (the HIGH markdown-link finding).
  - **Saran:** Migrate to parse_mode='HTML': HTML-escape entity values and emit <a href=...> for incident/SIEM links, which eliminates both this and the escaping/unescaped-content bugs.

- [ ] **#59 · LOW · tech_debt · telegram-messaging** — Fire-and-forget direct notifications leave no audit or retry record for delivery failures
  - **File:** `actions/incidents.ts:150,168; actions/checklist.ts:200`
  - **Bukti:** Incident and checklist paths dispatch 'sendTelegramAlert(...).catch(console.error)'. The documented rationale is sound, but a failed send results only in a console line: no audit log entry, no siem_alerts-style retry, and no visibility into delivery health.
  - **Dampak:** Ops has no way to know a critical/resolved incident notification never reached Telegram until it matters most; successes and failures are indistinguishable except in server logs.
  - **Saran:** Log send results via logAudit (action TELEGRAM_SEND with chatId + success/failure), and optionally persist a lightweight notification outbox for retries.

- [ ] **#60 · LOW · incomplete · incidents-checklist-fieldaudit** — field-audit-card.test.ts covers only input field names — no coverage for evidence flow, validation, or prefill
  - **File:** `components/checklist/field-audit-card.test.ts`
  - **Bukti:** The only test (lines 6-25) asserts name="status-42", name="remarks-42", and absence of name="deviceId" via renderToStaticMarkup. No test covers: photo input rendering when status is NOT OK (field-audit-card.tsx:133-150), the 10MB client-side validation (140-146), prefillStatus/prefillRemarks initialization, the onStatusChange effect, or the two radio option values.
  - **Dampak:** The card is the core of the field-audit flow and the recent deviceId fix is only regression-guarded for field names; a change that breaks evidence upload rendering, prefill hydration, or the size guard would ship without test coverage.
  - **Saran:** Add tests rendering the card in NOT-OK state asserting the photo input appears, tests for prefill values mapping to selected radio/textarea, and a test that a >10MB file clears the input (with a mocked window.alert).

- [ ] **#61 · LOW · bug · incidents-checklist-fieldaudit** — Incident status/assignment updates are read-then-write with no optimistic concurrency (TOCTOU)
  - **File:** `actions/incidents.ts:369-393 (assignIncident), 472-498 (changeIncidentStatus)`
  - **Bukti:** changeIncidentStatus reads `existing` and checks transitions against that snapshot, then updates with only next-derived values; assignIncident similarly reads `existing` then overwrites assignee/severity/dueDate. Neither uses a version column or a WHERE guard matching the read state. Incident update rows are appended unconditionally.
  - **Dampak:** Two concurrent agents acting on the same incident can both pass transition checks from the same stale base and last-write-wins: a concurrently resolved incident can be silently overwritten, and redundant incidentUpdates rows with stale previousStatus get appended, distorting the timeline.
  - **Saran:** Add an optimistic guard — e.g. .where(and(eq(incidents.id, id), eq(incidents.status, existing.status))) and re-check affected row count — or serialize transitions per incident with a row lock inside a transaction.

- [ ] **#62 · LOW · incomplete · incidents-checklist-fieldaudit** — Evidence photos are only submittable while a device card is visible; filtering/tab switches drop evidence, and submitChecklist writes photos without fs.mkdir
  - **File:** `components/checklist/checklist-form.tsx:216-228; components/checklist/field-audit-card.tsx:133-150; actions/checklist.ts:91-100`
  - **Bukti:** The hidden all-devices block emits only deviceId/status/remarks hidden inputs — no photo-${id} inputs. FieldAuditCard renders the file input only when status is NOT OK and only for visible cards. Switching category tabs unmounts a card, discarding the selected file before submit; OK-status devices cannot attach evidence at all. submitChecklist (91-100) writes photos without fs.mkdir (unlike saveUploadFile in lib/upload.ts:15) — a fresh-clone/dev environment with gitignored public/uploads will throw ENOENT mid-loop, compounding the partial-write issue.
  - **Dampak:** Field evidence is silently lost when the tech filters/leaves a device's tab before submitting, and there is no evidence channel for OK items; in environments where public/uploads was not pre-created, the whole checklist submission fails partway.
  - **Saran:** Persist selected photo in a per-device state map (blob URL or ref) and re-emit it in the hidden block so evidence survives tab switches; add fs.mkdir(uploadDir, { recursive: true }) before the checklist writeFile to match saveUploadFile.

- [ ] **#63 · LOW · tech_debt · network-rack-management-faceplate** — Faceplate eviction branch in buildFaceplate is dead code (override pass runs before guess pass)
  - **File:** `lib/faceplate.ts:340-368`
  - **Bukti:** buildFaceplate runs overrides in pass 0 and guesses in pass 1, so within pass 0 any occupied slot.port is itself an override (hasOverride true), and pass 1 has isOverridePass false — the branch `isOverridePass && !hasOverride(slot.port)` (line 357) can never be true. The comment 'the guess gives way' describes ordering, not eviction. Behavior is correct (tests pass).
  - **Dampak:** No functional defect; misleading dead branch and comment in the mapping logic that commit 01d52de was meant to make explainable.
  - **Saran:** Delete the eviction branch and document that pass ordering (explicit overrides first) implements the precedence, or restructure so eviction is actually exercised and tested.

- [ ] **#64 · LOW · tech_debt · network-rack-management-faceplate** — updateRack partial update silently flips isAuditable to false when the checkbox is absent; Zone '' stored instead of null
  - **File:** `actions/rack-management.ts:149`
  - **Bukti:** updateRack sets `isAuditable: parsed.data.isAuditable ?? false` while all other partial fields pass undefined through (drizzle skips undefined in .set()), so isAuditable is the only field force-overwritten on a partial update. It works today only because edit-rack-form.tsx always renders the checkbox. Also, clearing the Zone input stores '' instead of null (z.string().optional() accepts '').
  - **Dampak:** Fragile partial-update semantics: a future form that doesn't include the checkbox silently turns rack auditing off; zone cleared to empty string instead of NULL.
  - **Saran:** Use `parsed.data.isAuditable ?? current.isAuditable` and `parsed.data.zone ?? current.zone` (or normalize '' to null) so partial updates only change fields the caller actually sent.

- [ ] **#65 · LOW · incomplete · network-rack-management-faceplate** — Port-table Slot column can contradict the faceplate diagram for colliding ports
  - **File:** `components/admin/port-table.tsx:89-110`
  - **Bukti:** The Slot column calls resolveSlotNumber per row with no knowledge of collisions or the override pass: two ports that resolve to the same slot both display that slot number with an 'auto' badge, while the diagram places only one and moves the other to the unplaced list. The feature was added (commit 01d52de) specifically to make missing-ports explainable from the table.
  - **Dampak:** The table can show a port at 'Slot 5' while the faceplate renders it as unplaced — exactly the confusion the explainability commit set out to remove.
  - **Saran:** Compute buildFaceplate placement once in PortTable and render 'Unmapped' (or a conflict marker) for ports that are not the slot occupant, mirroring the diagram.

- [ ] **#66 · LOW · incomplete · network-rack-management-faceplate** — Bulk mode leaves mediaType defaulting to Copper, so uplink templates silently produce colliding/unplaced ports
  - **File:** `components/admin/add-port-form.tsx:76`
  - **Bukti:** Commit 01d52de removed portIndex from bulk adds ('the faceplate derives the slot from the name and media instead'), but the bulk form still defaults mediaType to 'Copper (RJ45)'. A bulk 'TenGigabitEthernet1/1/1-4' with default media derives slots 1-4 and collides with existing access ports, sending every generated uplink to the unplaced list with no proactive warning — the admin must remember to switch Media Type to Fiber.
  - **Dampak:** First-time bulk uplink provisioning looks broken (all ports unmapped) unless the admin manually sets fiber media; the placement rule that replaced portIndex is not surfaced in the form.
  - **Saran:** Auto-default Media Type to 'Fiber (SFP/SFP+)' for fiber-style templates (tenGigabit/fortyGigabit/hundredGigabit) in bulk mode, or show a hint that copper media ports land in the access block.

- [ ] **#67 · LOW · bug · auth-admin-routing-i18n** — switchSite action does not re-verify site.isActive when assigning the active site
  - **File:** `actions/auth.ts:189-219`
  - **Bukti:** switchSite checks requireSiteAccess (a userSites row exists) but the site lookup `.where(eq(sites.id, siteId))` (line 202) never filters isActive; getUserSites/select-site filter to isActive=true.
  - **Dampak:** A deactivated site can appear/operate as the active site for a user, inconsistent with the isActive filtering everywhere else (middleware, select-site, getUserSites). Minor state/authorization drift.
  - **Saran:** Add eq(sites.isActive, true) to the site lookup in switchSite and reject inactive sites.

- [ ] **#68 · LOW · incomplete · auth-admin-routing-i18n** — update.sh restarts only 5 of 9 worker services — stale code after deploy
  - **File:** `update.sh:134`
  - **Bukti:** SIEM_WORKER_SERVICES=(syslog-receiver siem-parser siem-rules siem-alerts siem-retention) (line 134). docker-compose.yml also defines siem-ai, siem-snapshot, incidents-overdue-notify (depends_on app), backup-scheduler. Step 6 restarts only the listed services after rebuilding the image.
  - **Dampak:** After an update, siem-ai, siem-snapshot, incidents-overdue-notify and backup-scheduler keep running stale container code until manually restarted, so newly deployed logic silently diverges from the app.
  - **Saran:** Extend SIEM_WORKER_SERVICES to include siem-ai siem-snapshot incidents-overdue-notify backup-scheduler (or restart all non-db, non-app services via their dependent healthchecks).

- [ ] **#69 · LOW · tech_debt · auth-admin-routing-i18n** — Settings page gate allows admin role while permissions.ts declares global settings superadmin-only
  - **File:** `app/[locale]/(dashboard)/admin/settings/page.tsx:16-18; lib/permissions.ts:8-9`
  - **Bukti:** Page gate allows global 'admin' to view the Settings page; lib/permissions.ts canManageGlobalSettings(role) returns true only for superadmin; the nav hides Settings from non-admin users but not from admins.
  - **Dampak:** Inconsistent policy: an admin-role user can open Global Settings (Telegram/app config, backup linkage) read surface; safety depends entirely on per-action guards. Minor authorization inconsistency.
  - **Saran:** Gate /admin/settings to superadmin-only to match permissions.ts and the settings write actions, or document the intended admin-level read.

- [ ] **#70 · LOW · incomplete · device-groups** — Minor CRUD gaps in device-groups: updatedAt never set on update; delete failures silently ignored in UI; search is client-side name-only with no pagination
  - **File:** `actions/device-groups.ts:125-129,143-164; components/admin/device-groups-client.tsx:45-48,119-124`
  - **Bukti:** updateDeviceGroup sets name/description/color only — device_groups.updated_at stays at insert time. deleteDeviceGroup's return value is discarded in the client (deleteDeviceGroup(group.id).then(() => router.refresh())), so a failed delete (auth, not-found) silently does nothing. Search filters only g.name client-side (no description search, no server-side pagination).
  - **Dampak:** Stale updated_at misleads auditing (when did this group actually change?); users get no feedback on failed deletes; long group lists have no pagination.
  - **Saran:** Set `updatedAt: new Date()` in the update; handle the delete result (toast/alert on failure) before refreshing; consider server-side search/pagination when group counts grow.

- [ ] **#71 · LOW · tech_debt · device-groups** — Mixed-language UX and no i18n keys for the device-groups page: English UI with Indonesian action errors
  - **File:** `components/admin/device-groups-client.tsx:57-284; actions/device-groups.ts:102,139,162; app/[locale]/(dashboard)/admin/device-groups/page.tsx:18-21`
  - **Bukti:** The page/client hardcode all strings ('PIC Groups', 'New Group', 'Filter groups…', 'No PIC groups'), while the server actions return Indonesian error messages ('Gagal menyimpan grup.', 'Grup tidak ditemukan.', 'ID grup tidak valid.'). messages/en.json and messages/id.json contain no device-groups keys. Some admin pages (settings, incidents, login, navbar) do use next-intl, so this page is inconsistent with the app's partial i18n pattern.
  - **Dampak:** Indonesian users see a mixed English/Indonesian admin flow; the locale switch (id/en) has no effect on this page; translators cannot localize it without code edits.
  - **Saran:** Add a DeviceGroups namespace to messages/en.json + messages/id.json and use getTranslations/useTranslations in the page and client (the existing partial-i18n pattern), at minimum moving the action error strings to the same language as the UI.

- [ ] **#72 · LOW · misscode · database-schema-migrations** — 0029 device_groups FK constraint is misnamed and is_active NOT NULL mismatches the schema
  - **File:** `drizzle/0029_devices_pics.sql:11,31-33; db/schema.ts:158`
  - **Bukti:** The FK constraint is named device_groups_site_id_device_groups_id_fk but actually references sites(id) (copy-paste from the devices FK naming pattern). Line 11: "is_active" boolean DEFAULT true NOT NULL on device_groups, while db/schema.ts:158 declares isActive: boolean("is_active").default(true) (nullable).
  - **Dampak:** The misleading constraint name hurts debugging and constraint-name-based tooling (drizzle snapshots, pg_dump reviews); the is_active nullability difference means the next generate/push will propose changing NOT NULL to nullable — churn and surprise schema changes.
  - **Saran:** Rename the constraint to device_groups_site_id_sites_id_fk (or add a new named constraint and drop the old), and align schema.ts is_active to .notNull().default(true) to match the migration, or drop NOT NULL in a follow-up migration — pick one and make both agree.

- [ ] **#73 · LOW · tech_debt · database-schema-migrations** — 0025 header comment says the migration is NOT registered in the journal, but _journal.json now registers it
  - **File:** `drizzle/0025_siem_per_site_constraints.sql:7-8; drizzle/meta/_journal.json`
  - **Bukti:** The header states 'NOT registered in meta/_journal.json — the drizzle migrator does not manage it' and 'Apply manually (like 0024): psql ...', but the journal registers both 0024_siem_per_site and 0025_siem_per_site_constraints (idx 24-25), so npm run db:migrate now executes them (they are idempotent, so double-apply is safe).
  - **Dampak:** Anyone reading the migration header (or the update.sh deploy path) is told to apply it manually via psql — which would run it OUTSIDE the migrator and could re-apply it out of order relative to 0026+. Stale operational instructions in a deployment-critical file.
  - **Saran:** Update the header comment to state that 0024/0025 ARE journaled and applied automatically by scripts/migrate.ts (idempotent by design), and remove the 'apply manually' instruction.

- [ ] **#74 · LOW · tech_debt · database-schema-migrations** — Journal 'when' timestamps inverted for 0016/0017 and rounded for 0008-0022 — ordering relies solely on idx
  - **File:** `drizzle/meta/_journal.json`
  - **Bukti:** Journal entries: idx 16 0016_si_partitioned when=1781500000000, idx 17 0017_watery_silver_surfer when=1781493399329 — the earlier migration carries a LATER timestamp. Entries 0008-0022 use rounded values indicating hand-editing; 0011 was deliberately removed (commit bfebd91). Drizzle's migrator applies by idx, so execution order is correct today.
  - **Dampak:** Any tooling or operator that interprets `when` as apply order (drizzle-kit diff preview, baseline comparison, manual audit) will read the sequence as 0017-before-0016; the rounding makes true creation order unreconstructable, complicating future baseline recovery.
  - **Saran:** Normalize the journal: set monotonic, realistic `when` values matching each migration's actual creation time (or regenerate via drizzle-kit), and add a comment in scripts/migrate.ts that ordering is by idx, not `when`, to prevent future misuse.

- [ ] **#75 · LOW · incomplete · cross-cutting** — Telegram markdown escape set incomplete — values starting with #, >, - or containing ~ inject formatting
  - **File:** `lib/telegram.ts:66-68`
  - **Bukti:** escapeTelegramMarkdown escapes only _ * ` [ ] (and backslash). Telegram legacy Markdown also treats line-start '#', '>', '-' (and '~' strikethrough) specially; deviceRemarks/deviceName/checker are user-supplied and rendered into the alert template unescaped for those characters.
  - **Dampak:** Markdown formatting injection / alert spoofing: a device remark beginning with '# ' or '> ' renders as a heading or quote block in every site alert, letting a low-privileged user alter the visual structure of alerts sent to the whole site's Telegram chat.
  - **Saran:** Extend the escape set to the full legacy Markdown special-char list (~ > # + - = | { } . ! \ and control chars) or switch to MarkdownV2 with strict escaping; add unit tests for line-start special characters.

- [ ] **#76 · LOW · incomplete · cross-cutting** — getUserById is an IDOR with no ownership/role check (any authenticated user can read any user's profile)
  - **File:** `actions/users.ts:61-76`
  - **Bukti:** getUserById only checks verifySession() truthiness; it returns username, email, role and site bindings for any user id (passwordHash excluded). It is currently not imported by any page/component (dead action), so exploitability requires deriving the action endpoint, but the guard is absent.
  - **Dampak:** PII disclosure (usernames, emails, roles, site assignments) across the user base if the action is ever wired into a UI or invoked directly; defense-in-depth gap in the users module.
  - **Saran:** Restrict to self (session.userId === id) or requireSuperadminAction; add a test covering unauthorized access.

- [ ] **#77 · LOW · incomplete · cross-cutting** — Public /api/health and superadmin /api/admin/restore leak raw error messages to clients
  - **File:** `app/api/health/route.ts:23-26; app/api/admin/restore/route.ts:68-79`
  - **Bukti:** The health route returns error.message verbatim in the public unauthenticated response (pg connection errors can include host/port/user); the restore route returns the raw thrown message (may include filesystem paths) to the caller.
  - **Dampak:** Minor information disclosure: internal host/user hints and server paths exposed; useful to attackers scanning the deployment for further targets.
  - **Saran:** Return sanitized status strings ('db: down') from /api/health and a generic 'Restore gagal' message from restore, logging full details server-side only.

- [ ] **#78 · LOW · tech_debt · cross-cutting** — AGENTS.md is stale: claims 'No automated test framework is currently configured' and omits npm test
  - **File:** `AGENTS.md:22-24`
  - **Bukti:** AGENTS.md:22-24 says 'No automated test framework is currently configured. Validate changes with npm run lint and npm run build…'. The repo has vitest configured (package.json:10-11 npm test / test:watch) with 76 test files / 420 tests, and the Testing Guidelines section lists no test command.
  - **Dampak:** Agents and contributors skip running the test suite (the 11 currently failing tests went unnoticed), and guidance actively contradicts the repo state.
  - **Saran:** Rewrite the Testing Guidelines section to document `npm run test` (and `npm run check`), list colocation conventions, and require green tests before handoff.

- [ ] **#79 · LOW · tech_debt · ui-build** — .dockerignore melewatkan database SQLite dev dan barang repo — ikut ke build context
  - **File:** `.dockerignore`
  - **Bukti:** Root berisi dc-check.db dan sqlite.db (SQLite dev), docs/, Screenshoot/, graphify-out/, TASK, GEMINI.md — tidak ada yang dikecualikan; `COPY . .` (Dockerfile L23) mengirim semuanya ke builder stage. Pola .env tidak menangkap .env.example. Image runner final tidak terpengaruh (hanya standalone.tar/assets.tar yang disalin).
  - **Dampak:** Build context membengkak, data dev masuk layer/cache builder, risiko menyemaikan kredensial dev ke cache build.
  - **Saran:** Tambah *.db, docs/, Screenshoot/, graphify-out/, .env.example* ke .dockerignore.

- [ ] **#80 · LOW · tech_debt · ui-build** — Dua pipeline font: next/font Geist tak terpakai plus ketergantungan runtime fonts.googleapis.com
  - **File:** `app/layout.tsx L8-16, L64-65; app/globals.css L34-35`
  - **Bukti:** Geist/Geist_Mono dimuat lewat next/font/google tapi tidak ada CSS/komponen yang memakai variabelnya; Inter dan Material Symbols diambil langsung dari Google via <link> runtime. Material Symbols dipakai halaman admin aktif (brands, users, sites, rack-manage, siem).
  - **Dampak:** Geist ter-download tiap build tanpa dipakai; di deploy docker/offline Inter jatuh ke font sistem dan ikon Material Symbols lenyap diam-diam saat Google tak terjangkau.
  - **Saran:** Buang next/font Geist; self-host Inter + glif Material Symbols yang dipakai, atau sediakan fallback ikon.

- [ ] **#81 · LOW · tech_debt · ui-build** — Dropdown AppShell kekurangan aria-expanded/aria-haspopup, penutup ESC, dan backdrop yang diberi label
  - **File:** `components/ui/app-shell.tsx L120-131, L133-164, L246-290`
  - **Bukti:** Toggle site-switcher dan user-menu tanpa aria-expanded/aria-haspopup; backdrop dismiss adalah <button> tanpa aria-label (screen reader mengumumkan tombol tanpa nama); menu tidak bisa ditutup dengan Escape. Modal.tsx justru mengimplementasi kontrak penuh (focus trap, ESC, aria-modal).
  - **Dampak:** Pengguna keyboard/screen reader mendapat target fokus yang membingungkan; inkonsisten vs primitif Modal.
  - **Saran:** Tambahkan aria-expanded/aria-haspopup, aria-hidden pada backdrop (atau div role=presentation), dan penanganan ESC.

- [ ] **#82 · LOW · tech_debt · ui-build** — theme-toggle.tsx memakai token legacy yang tidak konsisten dengan sistem ops-*
  - **File:** `components/ui/theme-toggle.tsx L32`
  - **Bukti:** Kelasnya text-muted hover:text-foreground hover:bg-surface-darker (set token legacy milik navbar mati) sementara AppShell sekitar memakai ops-*. bg-surface-darker diselesaikan shim globals.css (L131) ke var(--color-surface) — hover jadi tak terlihat di header terang.
  - **Dampak:** Umpan balik hover tak terlihat di light mode; penamaan token tidak konsisten di shell.
  - **Saran:** Migrasi ke text-ops-muted hover:text-ops-text hover:bg-ops-surface-raised.

- [ ] **#83 · LOW · tech_debt · ui-build** — Default port host syslog TCP 601 berbeda dari default container 1515 di compose yang sama
  - **File:** `docker-compose.yml L50 vs L57`
  - **Bukti:** Port mapping default 0.0.0.0:${SYSLOG_TCP_PORT:-601}:1515/tcp sedangkan env container untuk variabel yang sama default ${SYSLOG_TCP_PORT:-1515}. Tanpa variabel diset, pengirim eksternal harus memakai host 601 sementara receiver mendengarkan di 1515 (jalan hanya karena mapping 601→1515). 601 juga port syslog-TLS konvensional di sebagian perangkat.
  - **Dampak:** Default membingungkan; risiko salah konfigurasi saat operator menyalin 1515 dari sisi container sebagai port eksternal.
  - **Saran:** Samakan kedua default (1515 atau 601 konsisten) dan dokumentasikan port eksternal di output deploy.sh.
