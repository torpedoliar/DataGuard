# SIEM Rule Alert Settings + Navbar Menu — Design

Date: 2026-06-04

## Problem

SIEM findings created today were not delivered to Telegram while a finding from
June 3 was. Diagnosis (`scripts/check-siem-alert.js`) confirmed the bot and
pipeline work: the new findings come from the rule `firewall.deny_burst_source`
("Deny burst from same source") whose `alert_enabled = false`. There is **no UI**
to control which rules alert, and the SIEM section has **no link in the navbar**.

Two needs:
1. A settings page to control, per rule, whether it alerts to Telegram (and
   whether the rule runs at all), plus the global minimum alert severity.
2. A "SIEM" entry in the top navigation so the existing SIEM pages are reachable.

## Goals

- Admins can toggle, per rule: **Aktif** (`enabled`) and **Kirim ke Telegram**
  (`alert_enabled`).
- Admins can set the global **minimum alert severity** (`alert_min_severity`).
- A "SIEM" link in the navbar (admin-only) → `/admin/siem`, and a "Rules" action
  on the SIEM dashboard → `/admin/siem/rules`.
- User toggles **survive container restart / re-seed** (no reset to code
  defaults).

## Non-Goals

- No new sidebar (the app uses a top navbar; we extend it).
- No per-site rule configuration (rules are global, as today).
- No editing of rule logic (thresholds, conditions, groupBy) in the UI — only the
  two toggles and global min severity.
- No new alert channels (email/webhook out of scope).

## Architecture

### 1. Navigation (`components/ui/navbar.tsx`)

- Add a `SIEM` link in the main `<nav>` list, sibling to Dashboard / Reports /
  Incidents / Grid / About, rendered only when `isAdmin` is true. Target
  `/admin/siem`, using the existing `navLinkClass`/`isActive("/admin/siem")`
  styling.

### 2. SIEM dashboard action button (`app/(dashboard)/admin/siem/page.tsx`)

- Add a `Rules` `ActionButton` (variant secondary) to the existing actions row
  → `/admin/siem/rules`. Reuse a lucide icon (e.g. `SlidersHorizontal`).

### 3. Rules page (`app/(dashboard)/admin/siem/rules/page.tsx`)

- Server component. Guard: `verifySession()` → require `admin`/`superadmin`,
  require `activeSiteId` (mirror `siem/page.tsx`).
- Fetch via `getSiemRules()`; on `{ message }` render the error panel pattern.
- Render `PageHeader` (eyebrow "Admin / SIEM", title "SIEM Rules") +
  `<SiemRulesForm rules=... alertMinSeverity=... />`.

### 4. Rules form (`components/admin/siem-rules-form.tsx`)

- Client component using `useActionState(updateSiemRules, ...)` (match
  `settings-form` / existing SIEM forms pattern).
- Top control: **Severity minimum alert** select (`alertMinSeverity`, options
  from `siemSeverities`).
- Rules grouped by `category` (Authentication, Network, Firewall, System, SIEM
  Health). Each row shows: name, description, severity badge, and two toggles:
  - **Aktif** → `enabled[<id>]`
  - **Kirim ke Telegram** → `alertEnabled[<id>]`
- UX: when **Aktif** is off, the **Kirim ke Telegram** toggle is disabled/greyed
  (a disabled rule can never alert).
- Single **Simpan** button submits the whole form (no per-row autosave).
- Show success/error feedback consistent with existing forms.

### 5. Server actions (`actions/siem-settings.ts`)

- `getSiemRules()`:
  - `requireActiveSiteAdminAction()`; on failure return `{ message }`.
  - Select `id, key, name, description, category, severity, enabled, alertEnabled`
    from `siemRules`, ordered by `category` then severity rank then `name`.
  - Also return `alertMinSeverity` from `siemSettings`.
  - Return `{ rules, alertMinSeverity }`.
- `updateSiemRules(prevState, formData)`:
  - `requireActiveSiteAdminAction()`; on failure `{ message }`.
  - Parse with zod: `alertMinSeverity` ∈ `siemSeverities`; per-rule arrays of
    `{ id:number, enabled:boolean, alertEnabled:boolean }` reconstructed from
    `formData` (checkbox semantics: missing = false). Enforce
    `alertEnabled ⇒ enabled` server-side (clamp `alertEnabled=false` when
    `enabled=false`).
  - In a transaction: update each rule's `enabled` + `alertEnabled` + `updatedAt`;
    update/insert `siemSettings.alertMinSeverity`.
  - `logAudit({ action:"UPDATE", entity:"settings", entityName:"SIEM Rules" })`.
  - `revalidatePath("/admin/siem/rules")`; return `{ success: true }`.

### 6. Re-seed fix (`lib/siem/rule-runner.ts`)

- `seedDefaultSiemRules` currently does `onConflictDoUpdate` with
  `enabled: ...` and `alertEnabled: sql\`excluded.alert_enabled\``, overwriting
  user toggles on every startup.
- Change: on conflict (existing rule, matched by unique `key`), **do not update
  `enabled` or `alertEnabled`** — preserve the stored (user-controlled) values.
  Continue updating descriptive/logic metadata (name, description, severity,
  category, ruleType, conditions, groupBy, threshold, windowSeconds,
  cooldownSeconds, updatedAt) from code so rule definitions stay current.
- New rules (no existing `key`) are inserted with the code default
  (`alertEnabled ?? false`, `enabled` default true) as today.

## Data Flow

```
Admin → /admin/siem/rules → getSiemRules() → rules + alertMinSeverity
Admin toggles + Simpan → updateSiemRules()
  → UPDATE siem_rules.enabled/alert_enabled (per row, alertEnabled clamped to enabled)
  → UPDATE siem_settings.alert_min_severity
  → revalidatePath
siem-alerts worker (every 15s) → queueSiemTelegramAlerts()
  → reads rule.alertEnabled (now ON) → finding without a telegram alert row gets queued
  → sendPendingSiemTelegramAlerts() → delivered to Telegram
```

Existing findings already detected (e.g. #3/#4) auto-queue once their rule is
turned ON, because they have no telegram alert row yet (queue gate at
`alerts.ts:49`).

## Error Handling

- Actions return `{ message }` on auth failure and `{ errors }` on zod failure,
  matching existing SIEM action conventions; the form renders these.
- `alertEnabled ⇒ enabled` invariant enforced server-side regardless of client
  state.
- Re-seed change is backward compatible: a fresh DB still seeds code defaults;
  only existing rows are preserved.

## Testing

- `lib/siem/rule-runner` re-seed test: seeding twice with a flipped
  `alertEnabled`/`enabled` in the DB does NOT reset the stored value; a
  brand-new rule key is inserted with code default; metadata fields DO update.
- `updateSiemRules` validation: rejects bad `alertMinSeverity`; clamps
  `alertEnabled` to false when `enabled` is false.
- Manual: rebuild container, open /admin/siem/rules, enable
  `firewall.deny_burst_source` Telegram, confirm finding #3/#4 deliver within one
  worker cycle.

## Deployment Note

These are `.ts`/`.tsx` changes — the server must rebuild the app image
(`docker compose up -d --build`) for the page, navbar, and worker (shared image)
to pick them up.

## Affected Files

- `components/ui/navbar.tsx` (SIEM link)
- `app/(dashboard)/admin/siem/page.tsx` (Rules action button)
- `app/(dashboard)/admin/siem/rules/page.tsx` (new)
- `components/admin/siem-rules-form.tsx` (new)
- `actions/siem-settings.ts` (`getSiemRules`, `updateSiemRules`)
- `lib/siem/rule-runner.ts` (re-seed preserve toggles)
- Tests: `lib/siem/rule-runner.test.ts` (or sibling), action validation test
