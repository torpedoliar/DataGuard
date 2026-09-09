# Ticket 06 — POST /api/ncm/ingest: HMAC webhook → incidents + notifikasi

Date: 2026-09-09
Status: planned

## 1. Sumber kebenaran payload NCM (dibaca, bukan ditebak)

- Envelope + HMAC: `app_v4/service/notify.py` `Notifier.webhook()` — body
  `json.dumps(payload, separators=(",",":"))`, header `X-NCM-Signature: sha256=<hex>`.
- Fanout: `app_v4/service/events.py` `EventHub._webhook()` — body persis
  `{"type": <webhook-name>, "payload": <internal-payload>, "ts": <iso>}`.
- Nama webhook (`WEBHOOK_EVENT_MAP`): internal `backup_failed→backup_failed`,
  `backup_completed→backup_ok`, `config_drift→drift+review_opened` (dua webhook!),
  `review_opened→review_opened`, `review_decided→review_decided`,
  `device_offline→device_offline`.
- Bentuk `payload` per tipe (dari `backup_service.py` + `api/reviews.py`):
  backup_failed: `{switch_id, switch_name, backup_id, message}`;
  backup_ok: `{switch_id, switch_name, backup_id}`;
  drift (=config_drift): `{switch_id, switch_name, backup_id, review_id}`;
  review_opened: `{switch_id, switch_name, backup_id, review_id}`;
  review_decided: `{review_id, switch_id, status: approved|flagged|dismissed, comment}`;
  device_offline: `{switch_id, switch_name, backup_id}`.
- **Tidak ada `id` unik di payload** — tiket minta dedupe by NCM event ID,
  jadi skema validasi DG menerima `id` opsional top-level (NCM masa depan /
  proxy boleh menyuntik); bila absen, dedupe dihitung deterministik
  `sha256(type|switch_id|backup_id|review_id|status)` (ponytail: tanpa
  kolom baru, tanpa tabel event-log — kolom `description` incident menyimpan
  `ncm_event_id:<id>` sebagai marker).

## 2. Approach (tangga ponytail — reuse semua yang ada)

1. **Migrasi `drizzle/0058_ncm_webhook_secret.sql`** (hand-written, no
   generate/push; `when` = 0057 + 1000, idx 58) + entri `_journal.json`:
   `ALTER TABLE ncm_settings ADD COLUMN webhook_secret text;`
   Secret terenkripsi `lib/crypto.ts` (`encryptString`/`decryptIfEncrypted`),
   sama seperti `admin_api_key`. Settings UI (tiket 04 form) TIDAK diubah —
   secret diisi manual/seed dulu; kolom nullable = site tanpa secret → 401
   tertutup (fail-closed), zero-config breakage.
2. **`db/schema.ts`**: +1 kolom `webhookSecret` di `ncmSettings`. Itu saja.
3. **`lib/ncm-ingest.ts`** (baru, satu file; zod ada, `node:crypto` ada):
   - `ncmIngestSchema` — envelope: `type` enum 6 nilai, `payload` object
     longgar (switch_id/switch_name/backup_id/review_id/message/status/
     comment opsional), `ts` string, `id` opsional.
   - `verifyNcmSignature(rawBody, signatureHeader, secret)` — parse
     `sha256=<hex>`, `timingSafeEqual`, false bila apa pun janggal.
   - `dedupeKeyOf(event)` — `id` bila ada, else hash deterministik.
   - `resolveSeverity(type)` — backup_failed/device_offline→High,
     drift→Medium, review_opened/review_decided→Medium (ikut policy
     incidents; review decided approve ditangani sebagai auto-resolve,
     bukan incident baru).
   - `resolveDeviceId(db, siteId, switchName)` — cocok `devices.name` per
     site (ilike), fallback: device pertama site; null bila site kosong.
   - `processNcmEvent(deps, event)` — murni logika vs DB yang di-inject
     (TDD tanpa Postgres): dedupe → buat incident (High/Medium) →
     auto-resolve (backup_ok menutup backup_failed terbuka utk switch yg
     sama; review_decided approved menutup drift terbuka) → kembalikan
     aksi notifikasi. Insert `incident_updates` bertipe `comment` untuk
     jejak `ncm_event_id`.
4. **`app/api/ncm/ingest/route.ts`** (tipis, pola cron/siem-retention):
   baca raw body → cari site dari `?site=` atau payload? — TIDAK: cari
   berdasarkan secret? mustahil multi-site. Keputusan: query `ncm_settings`
   semua yang punya `webhook_secret`, coba verifikasi satu-per-satu
   (site count kecil; ponytail: tanpa kolom identifikasi baru); yang cocok
   = site pemilik. Rate-limit `lib/rate-limit.ts` (`ncm-ingest`, IP,
   60/min). CSRF-exempt (`middleware.ts` `csrfExemptPrefixes` +
   `/api/ncm/ingest`, pola `/api/siem-ingest`).
   Notifikasi: reuse `resolveIncidentRecipients`-style —
   `siteTelegramChatIds` + `sendTelegramAlert` fire-and-forget
   (pola `actions/incidents.ts`), tanpa audit-log blocking.
5. **Test `lib/ncm-ingest.test.ts`** (TDD red→green, pure functions +
   fake-deps processNcmEvent: HMAC vector vs Python, severity map,
   dedupe-key stabil, auto-resolve paths). Route di-skip (butuh Next+DB;
   logika di lib).

## 3. Yang SENGAJA di-skip

- UI settings untuk webhook_secret (tiket 04 form tidak disentuh; kolom
  diisi via SQL/seed; tambah bila operator minta).
- Tabel dedupe khusus / kolom event-id (marker di description cukup).
- Redis rate-limit (in-memory cukup; pola repo ini).
- review_opened/review_decided→incident baru (mereka komentar/resolve di
  incident drift yang ada — tiket bilang "ikut policy incidents yang ada").
