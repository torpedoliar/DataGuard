# Incident Center + SLA + Evidence Timeline Design

## Purpose

DC Check should turn checklist problems into accountable operational work. When a staff member records a `Warning` or `Error`, the system will create an incident that admins can assign, track, verify, and report.

## Scope

Phase 1 will add an Incident Center focused on checklist-driven incidents:

- Auto-create incidents from checklist items with `Warning` or `Error`.
- Show incident list and incident detail pages scoped to the active site.
- Support assignment, severity, due date, status workflow, comments, and evidence photos.
- Add dashboard summary cards for open, critical, due today, and overdue incidents.
- Include incident status in reporting filters and exports.
- Show a simple computed recurring indicator when the same device has multiple incidents in the last 30 days.

Out of scope for Phase 1: external ticketing integrations, complex SLA rule builders, multi-level approval chains, and configurable recurring analytics.

## Workflow

Incident status flow:

`Open` -> `In Progress` -> `Resolved` -> `Verified`

Staff can create checklist evidence and add updates to assigned incidents. Admins can assign incidents, change severity, set due dates, mark work as verified, and reopen unresolved work. Superadmins can operate across sites through the existing active-site model.

Default severity:

- Checklist `Warning` creates `Medium`.
- Checklist `Error` creates `High`.
- Critical categories can be upgraded manually to `Critical` in Phase 1.

## Data Model

Add `incidents` with site, device, checklist item reference, title, description, severity, status, creator, assignee, due date, resolved/verified metadata, and timestamps.

Add `incident_updates` with incident, author, update type, note, photo path, previous/new status, and timestamp. This table provides the evidence timeline and audit trail for operational follow-up.

## UI

Add `/admin/incidents` for the list view with filters for status, severity, assignee, due date, device, and computed recurring indicator. Add `/admin/incidents/[id]` for detail, timeline, assignment, status transition, and evidence upload.

Dashboard should show compact incident KPIs and prioritize overdue and critical open incidents.

## Notifications

Reuse the existing Telegram integration for high-signal events only:

- Critical incident opened.
- Incident becomes overdue.
- Incident resolved and waiting for verification.

## Permissions

All queries and mutations must be scoped by active site. Staff may view incidents they created or are assigned to, and may add updates only to assigned incidents. Admins may manage incidents for their active site. Superadmins may manage incidents through selected active site context.

## Testing

Add unit tests for status transition rules, severity defaults, and active-site permission checks. Add focused integration tests around auto-creation from checklist submission and incident update history.
