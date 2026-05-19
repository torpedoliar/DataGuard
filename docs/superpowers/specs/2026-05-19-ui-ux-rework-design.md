# DC-Check UI/UX Rework Design

## Purpose

Rework DC-Check into a sharper production operations interface for data center audit management. The UI should feel like a serious control surface for operators and admins, not a generic SaaS dashboard.

The approved direction is **Operations Command Center** as the baseline, with selected **Field-First Audit Tool** patterns for audit entry and QR scanning.

## Scope

The rework covers all main screens:

- App shell and navigation.
- Dashboard.
- Audit entry and QR scanner.
- Incident Center list and detail pages.
- Reports and audit grid.
- Admin inventory, racks, network, users, sites, settings, and update pages.
- Login and site selection.

The site selection flow after login must keep the map-based data center selection concept. The map should be refined, not removed.

Out of scope: database schema changes, server action rewrites, authentication changes, update script changes, external integrations, and new product features unrelated to UI/UX.

## Design Direction

The UI will use a dark operations surface with restrained color and high information density:

- Base: deep neutral dark surfaces.
- Primary action: teal/green accent.
- Status colors: green for OK, amber/orange for warning, red for critical/error.
- Radius: compact, mostly 5-8px.
- Tables and toolbars are first-class surfaces.
- Cards are used for individual repeated items, KPI blocks, modals, and framed tools only.
- Typography is compact and readable, with no hero-scale type inside operational screens.

Audit entry and QR scanner screens may use larger touch targets and stronger spacing because they serve onsite operators.

## Anti-Slop Rules

The rework must avoid common AI-generated UI patterns:

- No decorative gradient blobs, bokeh, or generic glass panels.
- No marketing hero sections inside the app.
- No card-inside-card page composition.
- No random purple/blue one-note palette.
- No icons or badges that do not support a real action, state, or scan task.
- No fake visual drama where dense operational clarity is needed.

Every visual block must support orientation, filtering, status recognition, or task execution.

## App Shell

Replace the crowded top-only navigation with an operations shell:

- Desktop: persistent left rail plus compact top context bar.
- Tablet: collapsed icon rail.
- Mobile: compact topbar with navigation drawer.

Left rail groups navigation by workflow:

- Operate: Dashboard, New Audit, QR Scanner, Audit Grid.
- Resolve: Incidents, Reports.
- Admin: Devices, Racks, Network, Users, Sites, Settings, System Update, shown by role.

The top context bar handles search, active site, site switcher, shift/time context, primary `New Audit` action, and user menu.

Page headers follow one pattern: breadcrumb, title, short operational subtitle, and optional action slot.

## Core Components

Add a shared UI layer for consistent screens:

- `AppShell`: responsive rail, top context bar, role-aware navigation.
- `PageHeader`: breadcrumb, title, subtitle, action slot.
- `StatsCard`: compact KPI card with optional severity tone.
- `DataToolbar`: search, filters, reset, and primary/secondary actions.
- `DataTable`: table wrapper, header styling, empty state, row density.
- `StatusBadge`: checklist status, incident severity, incident workflow status.
- `FormSection`: consistent form panel, label, help text, error text, footer.
- `ActionButton`: primary, secondary, danger, icon-only, pending states.
- `FieldAuditCard`: large touch controls for device audit status.

These components should wrap existing data and actions rather than changing business logic.

## Screen Workflows

### Dashboard

Dashboard becomes the operations overview:

- KPI strip for completion, checked devices, open incidents, critical incidents.
- Priority incident queue, not just passive cards.
- Daily audit progress by category.
- Recent activity feed with status tone.
- Quick actions for new audit, QR scanner, incident center, reports.

Charts should be simple and readable. Avoid decorative rings when a compact progress bar or status list is clearer.

### Audit Entry and QR Scanner

Audit entry uses Field-First patterns:

- Large OK, Warning, Error controls.
- Clear device identity: name, category, rack, location.
- Sticky submit summary with count of OK, Warning, Error, and unfilled devices.
- Photo/evidence affordance appears clearly for Warning/Error.
- Scanner should lead directly into a focused single-device audit card.

### Incident Center

Incident list becomes a remediation queue:

- Filters stay visible and compact.
- Severity, status, assignee, and due date are visible in each row.
- Overdue and critical states must stand out without overwhelming the page.
- Detail page uses a two-column layout: incident timeline and evidence on the left, action stack on the right.

### Reports and Audit Grid

Reports become an evidence review and export workspace:

- KPI row, filter bar, export action, dense compliance table.
- Photo/evidence access remains visible.
- Incident status is readable in the table.

Audit grid keeps the sticky-column layout but improves grouping, contrast, legend, and status scanning.

### Admin Screens

Admin screens use one inventory management pattern:

- Page header.
- Optional quick admin shortcuts.
- Data toolbar.
- Grouped dense table.
- Icon actions with accessible labels/tooltips.
- Modal or inline forms using `FormSection`.
- Consistent empty states and destructive confirmation language.

Device management, racks, network ports, brands, categories, locations, users, sites, settings, and update screens should share this pattern.

### Login and Site Selection

Login should match the dark operations visual system.

After login, the user still chooses a data center using the map-based selection concept. The map selector should be polished:

- Keep the Indonesia map and site markers.
- Reduce decorative starfield/glow effects that feel gimmicky.
- Improve marker labels, hover detail, and selected-site transition.
- Make fallback list for sites without coordinates prominent and usable.
- Keep the flow fast: select site, enter dashboard.

## Data Flow

Existing server components continue fetching data with current actions. Client components stay responsible only for UI interaction: menus, filters, modals, status controls, and pending states.

The active site model remains unchanged. All pages continue using the existing session and role checks.

## Error and Empty States

All data-heavy screens should use consistent states:

- Empty table state explains what is missing and the next useful action.
- Filtered-empty state distinguishes "no data" from "no match".
- Form errors appear near the affected field and in the submit footer when needed.
- Pending actions disable controls and show concise status text.
- Destructive actions use explicit object names in confirmation dialogs.

## Accessibility and Responsiveness

- Preserve keyboard navigation for menus, filters, buttons, and forms.
- Icon-only buttons need labels or tooltips.
- Status must not rely only on color; use text labels as well.
- Text must not overflow compact buttons or table cells.
- Mobile audit controls should remain comfortable to tap.
- Dense admin/report tables may scroll horizontally, but sticky headers/first columns should preserve context.

## Verification

Before handoff, run:

- `npm run lint`
- `npm run test`
- `npm run build`

Manual smoke checks:

- Login.
- Site selection through the map.
- Site fallback list when coordinates are missing.
- Dashboard.
- New audit submit flow.
- QR scanner entry flow.
- Incident list and detail.
- Reports with filters/export access.
- Audit grid.
- Admin device management and one representative modal form.

## Rollout Plan

Implementation should proceed in layers:

1. Add design tokens and shared UI primitives.
2. Replace dashboard layout with the new primitives.
3. Add `AppShell` and migrate dashboard/admin/report routes into it.
4. Rework Incident Center.
5. Rework audit entry and scanner with Field-First controls.
6. Rework reports and audit grid.
7. Rework admin inventory pages and forms.
8. Rework login and polish map-based site selection.

Each layer should keep existing behavior intact and should avoid unrelated refactors.
