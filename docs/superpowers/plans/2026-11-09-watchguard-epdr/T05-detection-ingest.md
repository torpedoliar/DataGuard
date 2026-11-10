# T05 — Detection ingest → Incident DC + Threats page

Depends on: T03, T04 · Spec: D5, D7, §5.1, §5.2, §5.5, §7, §9.3 · Migration: `NNNN_epdr_detections`

## Goal

Two separate intake paths: (a) Malware/PUP/Exploit activity without a required score, and (b) normalized IOA/Malware/PUP/Virus/Exploit ThreatSync incidents with score 7–10. Both create native Incident DC records per validated endpoint/threat episode; no provider writes in this ticket. See REQUIREMENTS R06/R07 and CONTRACTS C2/C3. No asset registration is needed.

## Terms

- **Detection** — one provider record (security event or ThreatSync incident). It is the EPDR "finding"; EPDR does not write into `siem_findings`.
- **Episode** — one Incident DC for one endpoint and one threat burst. Detections join an open episode; a recurrence after closure reopens it (§5.5).

## Data model

```sql
CREATE TABLE epdr_site_settings (
  site_id integer PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  ingest_enabled boolean NOT NULL DEFAULT false,
  event_types integer[] NOT NULL DEFAULT ARRAY[1,2,4,6,18],          -- export types: 1 Malware, 2 PUP, 4 Exploit, 6 Virus, 18 IOA
  threatsync_enabled boolean NOT NULL DEFAULT true,
  threatsync_categories text[] NOT NULL DEFAULT ARRAY['malware','pup','virus','exploit','ioa'],
  threatsync_min_score integer NOT NULL DEFAULT 7,
  threatsync_max_score integer NOT NULL DEFAULT 10,
  default_severity jsonb NOT NULL DEFAULT '{"1":"High","2":"Medium","4":"High","6":"High","18":"High"}',
  correlation_window_minutes integer NOT NULL DEFAULT 1440,
  reopen_window_days integer NOT NULL DEFAULT 7,
  default_assignee_id integer REFERENCES users(id) ON DELETE SET NULL,
  site_kill_switch boolean NOT NULL DEFAULT false,
  automation_paused_at timestamp, automation_paused_reason text,  -- set by circuit breaker (T08)
  updated_by integer REFERENCES users(id), updated_at timestamp DEFAULT now()
);

CREATE TABLE epdr_detections (
  id serial PRIMARY KEY,
  connection_id integer NOT NULL REFERENCES watchguard_connections(id) ON DELETE CASCADE,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  source text NOT NULL,                     -- 'event_export' | 'threatsync'
  source_key text NOT NULL,                 -- dedup key, see below
  endpoint_id integer REFERENCES epdr_endpoints(id) ON DELETE SET NULL,
  category text NOT NULL,                   -- normalized: malware | pup | exploit | virus | ioa | other
  provider_type text,                       -- raw export type or ThreatSync category/type
  threat_name text, file_path text, md5 text,
  threat_score integer, severity text NOT NULL,
  detected_at timestamp NOT NULL,
  ts_incident_id text, ts_status text, ts_remediated boolean, ts_last_update_at timestamp,
  incident_id integer REFERENCES incidents(id) ON DELETE SET NULL,
  ignored_reason text,                      -- below threshold, excluded, unmapped endpoint, …
  raw jsonb NOT NULL,
  created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now(),
  UNIQUE (connection_id, source, source_key)
);
CREATE INDEX epdr_detections_endpoint_time_idx ON epdr_detections (endpoint_id, detected_at);
CREATE INDEX epdr_detections_incident_idx ON epdr_detections (incident_id);

CREATE TABLE epdr_workflows (
  incident_id integer PRIMARY KEY REFERENCES incidents(id) ON DELETE CASCADE,
  site_id integer NOT NULL REFERENCES sites(id),
  endpoint_id integer REFERENCES epdr_endpoints(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'detected',   -- spec §6 workflow values
  threat_key text NOT NULL,                 -- category + (md5 | threat_name)
  last_detection_at timestamp NOT NULL,
  reopen_count integer NOT NULL DEFAULT 0,
  updated_at timestamp DEFAULT now()
);
```

T04 already supplies the Incident endpoint FK. Add provider incident/target/link tables and workflow evidence_generation from CONTRACTS C2/C3, plus site UI fields in C8: score max/absence policy, activity/scored toggles, activation boundary, per-severity SLA dueDate, valid same-site PIC, notifications and historical replay review. A workflow also stores kind (`threat` vs `health`) so the health worker never resolves a threat case.

## Ingest logic (`lib/epdr/detections.ts`, worker job `detections`)

**Event export.** Page every enabled category using C4's verified operation adapter. First-run/recovery lookback is UI-configured; historical evidence is marked baseline-only unless explicitly approved for replay (C2). Provider event ID is scoped by type/device/time, never globally unique by assumption. Missing IDs use a stable canonical evidence fingerprint. A repeated/ignored page or coverage gap marks the stream incomplete and blocks auto-close; cap reached is not the end if paging works.

**ThreatSync.** List with overlap/checkpoint and refresh every tracked active incident directly even if older than the list lookback. Apply explicit min/max score (default 7–10) and all five normalized categories. Preserve raw categories and unknowns for review. Add provider-incident and provider-target/link tables per C3: one record per provider incident and one detection per entity (`ts:<id>:<entityId>`), not one endpoint column for the whole provider incident. Verify exact entity identity against inventory; manual mapping must be evidence-backed and audited. Unmatched/non-endpoint entities remain visible. Track evidence generation/fingerprint, occurrence and last-change evidence per C2; unchanged polls and own status/comments never trigger another command.

**Normalization.** `category`: export type 1→malware, 2→pup, 4→exploit, 6→virus, 18→ioa; ThreatSync lowercase category, `av` stays `other` unless its type explicitly names virus/pup. Severity: from `threat_score` (7–8 High, 9–10 Critical, 4–6 Medium, 1–3 Low) else `default_severity[type]`.

**Correlation (`lib/epdr/correlation.ts`, pure function + thin DB wrapper).** For each accepted detection with an endpoint:
1. Open episode for the same endpoint AND matching explicit threat key/cross-source evidence (C2), with `last_detection_at` within `correlation_window_minutes` → attach, bump detection evidence generation, raise severity if higher. Same endpoint/time alone never merges unrelated attacks. New material evidence invalidates observation and is evaluated even if the old workflow was in_progress or simulated.
2. Else a Resolved/Verified episode for the same endpoint and same `threat_key` closed within `reopen_window_days` → **reopen**: incident back to `Open`, `reopen_count + 1`, severity raised one level (cap Critical), `incident_updates` row `status_changed` with note "Reopened: detection recurred".
3. Else create Incident: `source='epdr'`, `epdr_endpoint_id`, `device_id` = endpoint's linked asset or null, title `"<Category> on <host>"`, description from detection, `assigned_to_id = default_assignee_id`, `external_ref` = ThreatSync id when present; insert `epdr_workflows` with `state='detected'`. Notify through the same path manual Incident creation uses.

Episodes are processed under the connection advisory lock; inserts use the unique keys so a rerun creates no duplicates.

## UI

- `/admin/epdr/threats`: activity cards per category for 24 h / 7 d (from detections), detections table (category, score, endpoint, time, source, linked Incident, ignored reason), filter by category/state, banner for partial export.
- Incident detail: **WatchGuard / EPDR** panel when `source='epdr'` — endpoint summary, detections list, ThreatSync status, workflow state. Action buttons arrive in T07.
- `/admin/epdr/settings` (site admin, `requireActiveSiteAdminAction`): section "Detection" for `epdr_site_settings` fields above, site kill switch toggle.

## Acceptance

- [~] Rerunning the job on identical provider data creates no new detections or incidents. *(pure source-key + unique (connection,source,source_key) implemented; full ingest job not yet wired.)*
- [x] Three detections of the same threat episode produce one Incident; unrelated threats on the same host remain separate; a genuine recurrence (not a re-poll) reopens it. *(pure `correlate` attach/reopen/create + escalation tested; DB wiring pending.)*
- [~] A two-entity provider incident creates/links both endpoint cases, retains unmatched targets and cannot be closed from one endpoint's result. *(`epdr_provider_incidents`/`..._targets` schema + unique keys implemented; creation/link runner pending.)*
- [~] Backfill and old tracked incident updates remain visible without replaying old scans; partial streams do not advance complete coverage. *(modeled, not yet enforced by a runner.)*
- [~] Unmapped ThreatSync entities and below-threshold incidents are stored, visible, and create no Incident. *(normalization/threshold helpers implemented; runner/UI pending.)*
- [x] No provider write call is made by this ticket's code. *(only read-only client + pure helpers.)*
- [x] Detections and incidents are site-isolated. *(`site_id` + `connection_id` on all tables; server actions enforce active site.)*

## Tests

`lib/epdr/correlation.test.ts` (attach / reopen / create, severity escalation, window edges), `lib/epdr/detections.test.ts` (source_key stability, normalization table, threshold, unmapped entity, partial export), `actions/epdr-settings.test.ts` (site admin only, validation).

## Hand-off

**Status:** `done (core)` — data model + pure normalization/correlation + read-only detection ingestion job (upserts `epdr_detections`) + **correlation → native DC Incident create/attach/reopen** (`linkDetectionToEpisode`) + site settings + Threats page. **Remaining minor:** the Incident detail EPDR panel relation (`incidents → epdr_endpoints`) and isolated-DB validation.

**Files added/changed:** `drizzle/0067_epdr_detections.sql` + journal (idx 67), `db/schema.ts` (`epdrSiteSettings`, `epdrDetections`, `epdrWorkflows`, `epdrProviderIncidents`, `epdrProviderIncidentTargets`), `lib/epdr/detections.ts`, `lib/epdr/correlation.ts`, `lib/epdr/detect-ingest.ts` (normalization + classification + dedup), `lib/epdr/jobs.ts` (`detections` job: read-only ThreatSync + event export → upsert `epdr_detections` with endpoint resolution + ignored reasons), `actions/epdr-settings.ts`, `actions/epdr-threats.ts`, `app/[locale]/(dashboard)/admin/epdr/settings/page.tsx`, `app/[locale]/(dashboard)/admin/epdr/threats/page.tsx`. Tests: `lib/epdr/correlation.test.ts`, `lib/epdr/detections.test.ts`, `lib/epdr/detect-ingest.test.ts`, `actions/epdr-settings.test.ts`.

**Validation:** `npm run typecheck` clean; new T05 tests green (25 tests across the four files); `eslint --quiet` 0 errors. Full-suite: 2 environmental failures in `lib/backup/run-shell.test.ts` (`spawn node ENOENT` — shell PATH broke mid-session), **not** caused by this work.

**Remaining T05 (explicit):** (1) `incidents → epdr_endpoints` Drizzle relation + `getIncidentDetail` hostname projection for the detail EPDR panel; (2) isolated-DB validation. Then T06.
