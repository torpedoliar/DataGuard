# Ticket 08 — webhook NCM dikonfigurasi 100% via UI

Date: 2026-09-10
Status: implemented

## Goal

Remove the last manual-config tech debt: `webhook_url` + `webhook_secret` in
NCM's runtime_settings.json were only settable via SQL/API. Now DG's NCM
Connection form (per site) owns both, and saving pushes them to NCM with the
site's stored admin API key.

## Approach — reuse everything (tangga ponytail)

### NCM (Test Project)

1. `app_v4/data/repository.py`: `"system:write"` added to `KNOWN_SCOPES`
   (validated + normalized like every other scope).
2. `app_v4/service/api/system.py`: `PATCH /system/notify-settings` now uses
   `require_role_or_key("admin", scope="system:write")` instead of JWT-only
   `require_role("admin")`. GET stays JWT-only
   (`require_role("admin", "operator")`). Response/patch models and the
   handler body are untouched. Because notify audit uses `user_id` +
   `request.client.host` directly, the handler keeps `user: AccessClaims` —
   `require_role_or_key` returns `"key:<name>"` for keys, so the audit
   `user_id` becomes None for key callers and the action stays audited.
3. `app_v4/tests/test_scoped_api_keys.py`: new `system:write` matrix —
   scoped key PATCHes notify-settings (200), wrong-scope/legacy keys 403,
   no creds 401, JWT admin still 200, operator 403; scoped key keeps read
   endpoints 403 (no scope creep); audit rows for key writes carry
   `user_id IS NULL` + `"key"` in detail.

### DG (dc-check)

1. `lib/ncm.ts`: `setNcmWebhook(config, webhookUrl, webhookSecret)` —
   `ncmRequest(config, "PATCH", "system/notify-settings", { webhook_url,
   webhook_secret })` (10s timeout + same error mapping as every other
   call, free via ncmRequest).
2. `actions/ncm-settings.ts`:
   - `NcmSiteConfig` gains `webhookUrl: string` (stored value, shown in the
     form) + `webhookConfigured: boolean`.
   - `getNcmSettings` selects the two webhook columns.
   - `saveNcmWebhook(prevState, formData)` — superadmin guard identical to
     `saveNcmSettings` (verifySession + role check), zod: site id integer,
     URL empty-or-http(s) ≤200, secret ≤500 (NCM Field cap). Secret stored
     AES-256-GCM via `encryptString` (column `ncm_settings.webhook_secret`
     exists since 0058); URL stored plaintext like `url`.
   - After persisting, resolves the effective config and PATCHes
     `system/notify-settings` on NCM via `setNcmWebhook` with the stored
     admin API key. NCM error → `{ ok: false, message }` (shown in form),
     DB row still saved. Success message names the NCM target URL.
   - `logAudit` unchanged pattern; `revalidatePath("/admin/settings")`.
3. `components/admin/ncm-settings-form.tsx`: second `<form>` per site with
   `ncmWebhookUrl` + `ncmWebhookSecret` inputs, a configured/未 badge, and
   the ingest URL hint (`<dg-base>/api/ncm/ind`)
   surfaced so the operator can copy it into NCM. Errors render exactly
   like the connection form's.
4. `docs/runbook-ncm-dg.md` §3 rewritten: webhook is now configured from
   the DG UI (fields + push), no SQL/manual API anywhere; scope table
   gains `system:write`.
5. Tests:
   - `lib/ncm.test.ts` += setNcmWebhook: PATCHes `system/notify-settings`
     with JSON body, error mapping (403 → "NCM API responded 403", fetch
     failure includes URL).
   - `actions/ncm-settings.test.ts` (new) += saveNcmWebhook: superadmin
     guard denies non-superadmin, zod rejects a non-http URL, encrypted
     secret is persisted (ciphertext ≠ plaintext), PATCH call happens
     with resolved config, NCM error surfaces as `ok: false` message.

## Skipped (lazy / YAGNI)

- No GET status pull from NCM (badge = local DB state; NCM is source of
  truth for delivery, UI shows what DG knows).
- No separate test-connection button for the webhook (PATCH is the test —
  its error surfaces inline).
- No new migration (0058 already added webhook_secret).

## Validation

NCM: full pytest suite green. DG: `npm run check` green on touched files;
tsc 0 on the diff; commits `feat(ncm): system:write scope for webhook
config (ticket 08)` (NCM) and `feat(ncm): webhook config via UI (ticket
08)` (DG); no push.
