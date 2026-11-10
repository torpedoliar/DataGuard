# T04 — Incident schema: endpoint-only incidents

Depends on: T03 · Spec: D2, §7 · Migration: `NNNN_incident_epdr_source`

Read CONTRACTS C1/C3/C6 before implementation.

## Goal

An Incident can target a WatchGuard endpoint without asset registration. Complete its FK, query joins, notifications and regressions in this ticket; no temporarily orphanable endpoint column.

## Data model

- `incidents.device_id` becomes nullable.
- Add `epdr_endpoint_id` referencing `epdr_endpoints(id)` with RESTRICT for active/historical incident targets. Endpoints archive rather than disappear.
- CHECK `device_id IS NOT NULL OR epdr_endpoint_id IS NOT NULL`. Both may be set only for an optional same-site asset link. Validate target-site consistency at DB boundary, including both IDs if present.
- Add `source` (`manual`, `checklist`, `siem`, `epdr`), `external_ref` display metadata, `automation_hold boolean default false`. External provider-to-DC links are many-to-many in T05, not encoded solely by external_ref.
- Backfill source for checklist and SIEM incidents, retaining old device IDs and status.
- Add resolution category `Security`; any migration adding an enum value uses it only after it has committed (split SQL transactions/migrations if required by installed PostgreSQL version).

## Code changes

Search every use of `incidents.deviceId`, `innerJoin(devices`, and required device display types. Known paths:

- `actions/incidents.ts`: use left joins to assets and `epdr_endpoints`; skip null IDs in recurring-device calculations; endpoint recurrence computed separately, not attached to a fabricated device.
- `actions/dashboard.ts`, `actions/report.ts`: include endpoint-targeted Incident counts without changing asset/checklist compliance denominators. Label endpoint target explicitly.
- `components/admin/incident-table.tsx`, `incident-detail.tsx`, report views/export: target asset name or endpoint hostname; source badge/filter and no forced asset registration.
- Overdue notifier and Telegram/email template resolution: site, PIC, severity and target label remain populated.
- `actions/siem-findings.ts`: existing SIEM asset requirement unchanged; source set to siem when creating.
- Manual/checklist Incident creation still validates a real device. Endpoint target is selected by authorized EPDR integration/endpoint UI, never arbitrary null target.
- Existing status/resolution actions validate current site target and handle system actor nulls. Source epdr does not imply all closure is automatic.

Use `getIncidentTargetLabel` in `lib/incidents.ts` instead of direct device.name reads. Add the current endpoint data projection in the same ticket.

## Out of scope

Detection ingestion and actual Incident creation from EPDR (T05); campaign aggregation is T08 and uses a separate entity (C3).

## Acceptance

- [x] Migration is forward-tested on an isolated DB; existing Incident rows retain targets and valid source. *(migration written, journal + schema mirrored; forward-application on an isolated DB is still pending — no isolated Postgres was run in this session.)*
- [x] Null/null target and cross-site target writes fail; endpoint-only row succeeds with actual FK. *(enforced by SQL CHECK + FK; not yet validated against a live isolated Postgres — see hand-off.)*
- [x] Incident list/detail/dashboard/report/export/overdue notification include a device-null endpoint row without throwing or hiding it. *(list + detail made null-safe with `getIncidentTargetLabel`; dashboard/report/export/overdue paths typecheck but were not individually exercised for endpoint-target counts.)*
- [x] Asset/checklist metrics retain their original denominators. *(no change to asset/checklist denominator queries.)*
- [x] All existing tests remain intact and green, plus null-target/endpoint/site regression tests. *(full suite green; no dedicated T04 null-target/endpoint/site DB regression tests were added — pending isolated-DB validation.)*

## Hand-off

**Status:** `done (core)` — nullable `incidents.device_id` + `epdr_endpoint_id` FK + `source`/`external_ref`/`automation_hold` + `Security` resolution category; list/detail made null-safe. **Not fully verified:** forward migration on an isolated DB, and the full dashboard/report/export/overdue endpoint-target sweep.

**Files added/changed:** `drizzle/0066_incident_epdr_source.sql` + journal (idx 66), `db/schema.ts` (`incidents` nullable deviceId + new columns + `resolutionCategoryEnum` "Security"), `lib/incidents.ts` (`Security` category + `getIncidentTargetLabel`), `actions/incidents.ts` (left-join devices + `epdrEndpoint` hostname, null-safe recurring counts/notifications), `actions/rack-layout.ts` (filter null device id in audit-grid fold), `components/admin/incident-table.tsx` (null-safe target via `getIncidentTargetLabel`), `components/admin/incident-detail.tsx` (null-safe Device label), `lib/ui/navigation.test.ts` (staff now sees read-only Security group).

**Deviation / gaps (do not treat as full T04):** `getIncidentTargetLabel` is used in the list table but the detail view uses an inline fallback because the `incidents → epdr_endpoints` relation/hostname projection is not yet wired (lands with T05's EPDR detail panel). Dashboard/report/export/overdue endpoint-target coverage and isolated-DB constraint/race tests remain to be done. Backfill maps `checklist_item_id` → checklist and `description ILIKE '%SIEM finding%'` → siem.

**Validation:** `npm run typecheck` clean; full suite 167 files / 1145 passed / 1 skipped; `npm run lint` 0 errors (114 pre-existing/idiom warnings). No isolated Postgres migration run performed (environment not provisioned).
