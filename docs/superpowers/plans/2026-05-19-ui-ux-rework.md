# DC-Check UI/UX Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework DC-Check into a production-grade data center operations UI with an Operations Command Center baseline and Field-First audit controls.

**Architecture:** Build a shared UI system layer first, then migrate screens phase-by-phase without changing business logic. Server components keep fetching data through existing actions; new client components handle only interaction, navigation, filters, menus, and pending states.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict mode, Tailwind CSS v4, lucide-react, Drizzle/PostgreSQL, Vitest.

---

## Guardrails

- Do not modify database schema, migrations, server action behavior, auth/session logic, update scripts, Docker files, or deployment scripts unless a phase explicitly says so.
- Keep the map-based data center selection after login. Polish it; do not remove it.
- Keep active-site and role checks intact.
- Use shared components instead of one-off page styling.
- Avoid decorative gradient blobs, glassmorphism, marketing heroes, card-inside-card layouts, and one-note purple/blue dashboards.
- Run the listed verification for each phase before committing that phase.

## File Ownership Map

### New Shared UI Files

- Create `lib/ui/status.ts`: status/severity tone mapping and label helpers.
- Create `lib/ui/navigation.ts`: role-aware app navigation groups.
- Create `lib/ui/status.test.ts`: Vitest coverage for tone mapping.
- Create `lib/ui/navigation.test.ts`: Vitest coverage for role navigation.
- Create `components/ui/action-button.tsx`: shared button variants and pending state.
- Create `components/ui/page-header.tsx`: breadcrumb/title/subtitle/action header.
- Create `components/ui/status-badge.tsx`: reusable status/severity badge.
- Create `components/ui/stats-card.tsx`: compact KPI surface.
- Create `components/ui/data-toolbar.tsx`: search/filter/action wrapper.
- Create `components/ui/data-table.tsx`: table shell, empty state, header/body styles.
- Create `components/ui/form-section.tsx`: shared form panel and footer.
- Create `components/ui/app-shell.tsx`: left rail, top context bar, mobile drawer.
- Create `components/checklist/field-audit-card.tsx`: large audit status controls.

### Existing Files To Modify

- Modify `app/globals.css`: design tokens, shell utilities, scrollbar, focus styles.
- Modify `app/(dashboard)/layout.tsx`: replace `Navbar` with `AppShell`.
- Keep `components/ui/navbar.tsx` until migration is complete, then remove or leave unused only if no imports remain.
- Modify `app/(dashboard)/checklist/page.tsx`: new dashboard composition.
- Modify `app/(dashboard)/admin/incidents/page.tsx`: incident queue layout.
- Modify `components/admin/incident-table.tsx`: shared table/status badges.
- Modify `components/admin/incident-detail.tsx`: timeline plus action stack.
- Modify `components/admin/incident-assignment-form.tsx`, `incident-status-form.tsx`, `incident-update-form.tsx`: `FormSection` styling.
- Modify `app/audit/new/page.tsx`, `components/checklist/checklist-form.tsx`, `app/audit/scan/scanner-client.tsx`: Field-First audit UI.
- Modify `app/(dashboard)/report/page.tsx`, `components/report/report-filters.tsx`, `components/report/export-button.tsx`: report workspace.
- Modify `app/(dashboard)/grid/page.tsx`, `components/grid/grid-filters.tsx`: audit grid polish.
- Modify `app/(dashboard)/admin/page.tsx`, `components/admin/device-table.tsx`, and representative admin forms/tables: admin inventory pattern.
- Modify `app/login/page.tsx`: dark operations login.
- Modify `app/select-site/page.tsx`, `components/ui/map-selector.tsx`: polished map selection.

---

## Phase 0: Baseline And Safety

**Files:**
- Read only: current app files.
- Modify only if missing: `.gitignore`.

- [ ] **Step 1: Confirm clean starting point**

Run:

```powershell
git status --short --branch
```

Expected: no unrelated modified tracked files. Ignored `.superpowers/` is acceptable.

- [ ] **Step 2: Run baseline checks**

Run:

```powershell
npm run lint
npm run test
npm run build
```

Expected: lint has no errors, tests pass, build succeeds. Existing warnings can remain if unrelated.

- [ ] **Step 3: Record known warnings**

If lint warnings exist, record the count in the phase notes and do not fix unrelated warnings in this UI rework.

- [ ] **Step 4: Commit only if `.gitignore` needed a local session ignore**

Run only if `.gitignore` changed:

```powershell
git add .gitignore
git commit -m "chore: ignore local visual companion sessions"
```

Expected: commit contains only `.gitignore`.

---

## Phase 1: Design Tokens And Shared UI Primitives

**Files:**
- Create: `lib/ui/status.ts`
- Create: `lib/ui/navigation.ts`
- Create: `lib/ui/status.test.ts`
- Create: `lib/ui/navigation.test.ts`
- Create: `components/ui/action-button.tsx`
- Create: `components/ui/page-header.tsx`
- Create: `components/ui/status-badge.tsx`
- Create: `components/ui/stats-card.tsx`
- Create: `components/ui/data-toolbar.tsx`
- Create: `components/ui/data-table.tsx`
- Create: `components/ui/form-section.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write failing tests for status tones**

Create `lib/ui/status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getIncidentSeverityTone, getIncidentStatusTone, getChecklistStatusTone } from "./status";

describe("status tone helpers", () => {
  it("maps checklist statuses to stable tones", () => {
    expect(getChecklistStatusTone("OK")).toBe("success");
    expect(getChecklistStatusTone("Warning")).toBe("warning");
    expect(getChecklistStatusTone("Error")).toBe("danger");
    expect(getChecklistStatusTone("Unknown")).toBe("neutral");
  });

  it("maps incident severities to stable tones", () => {
    expect(getIncidentSeverityTone("Low")).toBe("neutral");
    expect(getIncidentSeverityTone("Medium")).toBe("warning");
    expect(getIncidentSeverityTone("High")).toBe("orange");
    expect(getIncidentSeverityTone("Critical")).toBe("danger");
  });

  it("maps incident workflow statuses to stable tones", () => {
    expect(getIncidentStatusTone("Open")).toBe("info");
    expect(getIncidentStatusTone("In Progress")).toBe("accent");
    expect(getIncidentStatusTone("Resolved")).toBe("purple");
    expect(getIncidentStatusTone("Verified")).toBe("success");
  });
});
```

Run:

```powershell
npm run test -- lib/ui/status.test.ts
```

Expected: FAIL because `lib/ui/status.ts` does not exist.

- [ ] **Step 2: Implement status tone helpers**

Create `lib/ui/status.ts`:

```ts
export type UiTone = "neutral" | "success" | "warning" | "orange" | "danger" | "info" | "accent" | "purple";

export function getChecklistStatusTone(status: string | null | undefined): UiTone {
  if (status === "OK") return "success";
  if (status === "Warning") return "warning";
  if (status === "Error") return "danger";
  return "neutral";
}

export function getIncidentSeverityTone(severity: string | null | undefined): UiTone {
  if (severity === "Critical") return "danger";
  if (severity === "High") return "orange";
  if (severity === "Medium") return "warning";
  return "neutral";
}

export function getIncidentStatusTone(status: string | null | undefined): UiTone {
  if (status === "Verified") return "success";
  if (status === "Resolved") return "purple";
  if (status === "In Progress") return "accent";
  if (status === "Open") return "info";
  return "neutral";
}
```

Run:

```powershell
npm run test -- lib/ui/status.test.ts
```

Expected: PASS.

- [ ] **Step 3: Write failing tests for role navigation**

Create `lib/ui/navigation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getAppNavigation } from "./navigation";

describe("app navigation", () => {
  it("shows operator and resolve groups to staff", () => {
    const groups = getAppNavigation("staff");
    expect(groups.map((group) => group.label)).toEqual(["Operate", "Resolve"]);
    expect(groups.flatMap((group) => group.items.map((item) => item.href))).toContain("/audit/new");
    expect(groups.flatMap((group) => group.items.map((item) => item.href))).not.toContain("/admin/users");
  });

  it("shows admin management items to admins", () => {
    const hrefs = getAppNavigation("admin").flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toContain("/admin");
    expect(hrefs).toContain("/admin/incidents");
    expect(hrefs).not.toContain("/admin/sites");
  });

  it("shows global management items to superadmins", () => {
    const hrefs = getAppNavigation("superadmin").flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toContain("/admin/users");
    expect(hrefs).toContain("/admin/sites");
    expect(hrefs).toContain("/admin/settings");
    expect(hrefs).toContain("/admin/update");
  });
});
```

Run:

```powershell
npm run test -- lib/ui/navigation.test.ts
```

Expected: FAIL because `lib/ui/navigation.ts` does not exist.

- [ ] **Step 4: Implement role navigation**

Create `lib/ui/navigation.ts`:

```ts
export type UserRole = "staff" | "admin" | "superadmin" | string;

export type NavItem = {
  href: string;
  label: string;
  icon: string;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

const operateItems: NavItem[] = [
  { href: "/checklist", label: "Dashboard", icon: "layout-dashboard" },
  { href: "/audit/new", label: "New Audit", icon: "clipboard-check" },
  { href: "/audit/scan", label: "QR Scanner", icon: "qr-code" },
  { href: "/grid", label: "Audit Grid", icon: "grid-3x3" },
];

const resolveItems: NavItem[] = [
  { href: "/admin/incidents", label: "Incidents", icon: "circle-alert" },
  { href: "/report", label: "Reports", icon: "chart-column" },
];

const adminItems: NavItem[] = [
  { href: "/admin", label: "Devices", icon: "server" },
  { href: "/admin/rack-manage", label: "Racks", icon: "boxes" },
  { href: "/admin/rack", label: "Rack Layout", icon: "panel-top" },
  { href: "/admin/network/vlans", label: "Network", icon: "network" },
  { href: "/admin/brands", label: "Brands", icon: "tag" },
  { href: "/admin/categories", label: "Categories", icon: "folder-tree" },
  { href: "/admin/locations", label: "Locations", icon: "map-pin" },
  { href: "/admin/audit-log", label: "Audit Log", icon: "history" },
];

const superadminItems: NavItem[] = [
  { href: "/admin/users", label: "Users", icon: "users" },
  { href: "/admin/sites", label: "Sites", icon: "building-2" },
  { href: "/admin/settings", label: "Settings", icon: "settings" },
  { href: "/admin/update", label: "System Update", icon: "download" },
];

export function getAppNavigation(role: UserRole): NavGroup[] {
  const groups: NavGroup[] = [
    { label: "Operate", items: operateItems },
    { label: "Resolve", items: resolveItems },
  ];

  if (role === "admin" || role === "superadmin") {
    groups.push({ label: "Admin", items: adminItems });
  }

  if (role === "superadmin") {
    groups.push({ label: "Global", items: superadminItems });
  }

  return groups;
}
```

Run:

```powershell
npm run test -- lib/ui/navigation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update global tokens**

Modify `app/globals.css` to define operations colors and shared utility classes. Keep existing Tailwind import.

Required token values:

```css
@theme {
  --color-ops-bg: #090d13;
  --color-ops-surface: #101721;
  --color-ops-surface-raised: #111820;
  --color-ops-border: #263244;
  --color-ops-muted: #8090a4;
  --color-ops-text: #f8fafc;
  --color-ops-accent: #5dd4b4;
  --color-ops-info: #60a5fa;
  --color-ops-success: #3bd17f;
  --color-ops-warning: #f0b94b;
  --color-ops-orange: #f97316;
  --color-ops-danger: #ff6b6b;
}
```

Keep old custom color names temporarily if existing pages still reference them.

- [ ] **Step 6: Create shared primitive components**

Create the shared files listed above. Requirements:

- `ActionButton` supports `variant="primary" | "secondary" | "danger" | "ghost"`, `isPending`, and `icon`.
- `PageHeader` accepts `eyebrow`, `title`, `description`, `actions`.
- `StatusBadge` accepts `tone`, `children`, optional `dot`.
- `StatsCard` accepts `label`, `value`, `tone`, `icon`, optional `meta`.
- `DataToolbar` provides a consistent bordered toolbar wrapper.
- `DataTable` provides wrapper classes and empty-state support, not a custom data engine.
- `FormSection` provides title, description, children, footer.

Use `clsx` for variant classes. Use lucide icons in buttons where already available.

- [ ] **Step 7: Verify Phase 1**

Run:

```powershell
npm run test -- lib/ui/status.test.ts lib/ui/navigation.test.ts
npm run lint
npm run build
```

Expected: tests pass, lint has no errors, build succeeds.

- [ ] **Step 8: Commit Phase 1**

```powershell
git add app/globals.css lib/ui components/ui
git commit -m "feat(ui): add operations design primitives"
```

---

## Phase 2: App Shell And Navigation

**Files:**
- Create: `components/ui/app-shell.tsx`
- Modify: `app/(dashboard)/layout.tsx`
- Read: `components/ui/navbar.tsx`

- [ ] **Step 1: Implement `AppShell`**

Create `components/ui/app-shell.tsx` with:

- `"use client"` directive.
- Props: `user`, `activeSite`, `userSites`, `appSettings`, `children`.
- Left rail generated from `getAppNavigation(user.role)`.
- Top context bar with search input, active site switcher, `New Audit`, and user menu.
- Mobile drawer state.
- Site switch logic reused from current `Navbar`: call `switchSite(siteId)`, close menu, reload.
- Logout reused from current `Navbar`.

- [ ] **Step 2: Replace dashboard layout wrapper**

Modify `app/(dashboard)/layout.tsx`:

- Import `AppShell` instead of `Navbar`.
- Pass the same `user`, `activeSite`, `userSites`, `appSettings`.
- Wrap `{children}` inside `AppShell`.

Expected shape:

```tsx
return (
  <AppShell
    user={{ username: session.username, role: session.role, photoPath: userDb?.photoPath || null }}
    activeSite={{ id: session.activeSiteId, name: activeSiteName }}
    userSites={userSites}
    appSettings={{ appName: appSettings.appName, logoPath: appSettings.logoPath }}
  >
    {children}
  </AppShell>
);
```

- [ ] **Step 3: Verify no broken imports**

Run:

```powershell
rg -n "Navbar" app components
npm run lint
npm run build
```

Expected: `Navbar` may remain only in its own file if unused. Build succeeds.

- [ ] **Step 4: Commit Phase 2**

```powershell
git add "app/(dashboard)/layout.tsx" components/ui/app-shell.tsx
git commit -m "feat(ui): add operations app shell"
```

---

## Phase 3: Dashboard Rework

**Files:**
- Modify: `app/(dashboard)/checklist/page.tsx`
- Use: `PageHeader`, `StatsCard`, `StatusBadge`, `ActionButton`

- [ ] **Step 1: Replace page container**

Change dashboard root to use shell-friendly spacing:

```tsx
<main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-6">
```

- [ ] **Step 2: Replace header with `PageHeader`**

Use:

```tsx
<PageHeader
  eyebrow="Operate / Dashboard"
  title="Operations Overview"
  description="Audit completion, incident pressure, and recent device activity for the active site."
  actions={<ActionButton href="/audit/new">New Audit</ActionButton>}
/>
```

- [ ] **Step 3: Replace quick stats with `StatsCard` row**

Show:

- Completion rate.
- Checked devices.
- Open incidents.
- Critical/overdue incidents.

- [ ] **Step 4: Recompose dashboard body**

Use three sections:

- `Priority Incidents`: top open/critical/overdue summary from existing `stats.incidentStats`.
- `Audit Progress`: category progress as compact bars instead of decorative rings.
- `Recent Activity`: timeline list with `StatusBadge`.

- [ ] **Step 5: Keep quick actions compact**

Keep links for full audit, QR scanner, Incident Center, Reports, Grid. Use one row of compact action tiles, not large decorative cards.

- [ ] **Step 6: Verify Phase 3**

Run:

```powershell
npm run lint
npm run build
```

Manual smoke:

- Open `/checklist`.
- Confirm `New Audit`, `QR Scanner`, `Incident Center`, `Reports`, and `Grid` links work.
- Confirm empty activity state still renders.

- [ ] **Step 7: Commit Phase 3**

```powershell
git add "app/(dashboard)/checklist/page.tsx"
git commit -m "feat(ui): rework dashboard operations overview"
```

---

## Phase 4: Incident Center Rework

**Files:**
- Modify: `app/(dashboard)/admin/incidents/page.tsx`
- Modify: `components/admin/incident-table.tsx`
- Modify: `components/admin/incident-detail.tsx`
- Modify: `components/admin/incident-assignment-form.tsx`
- Modify: `components/admin/incident-status-form.tsx`
- Modify: `components/admin/incident-update-form.tsx`

- [ ] **Step 1: Rework incident list header and stats**

Use `PageHeader` and `StatsCard`.

Filters remain URL-backed form controls with names:

- `status`
- `severity`
- `due`

- [ ] **Step 2: Rework `IncidentTable`**

Use shared table shell:

- First column: incident ID/title and recurring indicator.
- Device column.
- Severity with `StatusBadge`.
- Status with `StatusBadge`.
- Assignee.
- Due date with overdue/today tone if detectable from the date.
- Action button.

- [ ] **Step 3: Rework incident detail layout**

Use:

- Left column: summary card and timeline.
- Right column: assignment, status transition, update form.
- Keep existing props and mutations unchanged.

- [ ] **Step 4: Rework incident forms with `FormSection`**

Each form should:

- Keep current action handlers.
- Keep current field names.
- Use consistent labels, selects, date inputs, textarea, and submit footer.

- [ ] **Step 5: Verify Phase 4**

Run:

```powershell
npm run lint
npm run build
```

Manual smoke:

- `/admin/incidents` filters submit and preserve expected rows.
- `/admin/incidents/[id]` renders timeline and forms.
- Assignment/status/update actions still submit.

- [ ] **Step 6: Commit Phase 4**

```powershell
git add "app/(dashboard)/admin/incidents/page.tsx" components/admin/incident-table.tsx components/admin/incident-detail.tsx components/admin/incident-assignment-form.tsx components/admin/incident-status-form.tsx components/admin/incident-update-form.tsx
git commit -m "feat(ui): rework incident center queue"
```

---

## Phase 5: Field-First Audit And Scanner

**Files:**
- Create: `components/checklist/field-audit-card.tsx`
- Modify: `app/audit/new/page.tsx`
- Modify: `components/checklist/checklist-form.tsx`
- Modify: `app/audit/scan/scanner-client.tsx`

- [ ] **Step 1: Extract `FieldAuditCard`**

Create `components/checklist/field-audit-card.tsx`.

Required props:

```ts
type FieldAuditCardProps = {
  device: {
    id: number;
    name: string;
    locationName: string | null;
  };
  isHighlighted?: boolean;
};
```

It owns local `status` state and renders:

- Hidden `deviceId`.
- Device name and location.
- Three large radio labels: OK, Warning, Error.
- Remarks textarea.
- Photo input shown for Warning/Error.

- [ ] **Step 2: Update `ChecklistForm`**

Replace internal `DeviceRow` with `FieldAuditCard`.

Add a sticky footer summary that shows:

- Total visible devices in current category.
- Submit button.
- Action state message.

Do not change field names:

- `deviceId`
- `status-${device.id}`
- `remarks-${device.id}`
- `photo-${device.id}`

- [ ] **Step 3: Rework `app/audit/new/page.tsx`**

Use `PageHeader`.

Keep `prefillDeviceId` behavior unchanged.

- [ ] **Step 4: Rework scanner client**

In `app/audit/scan/scanner-client.tsx`:

- Keep existing QR scanning logic.
- Rework visual shell to match Field-First pattern.
- Keep route transition to `/audit/new?deviceId=...`.
- Show clear error states for permission/scanner failure.

- [ ] **Step 5: Verify Phase 5**

Run:

```powershell
npm run lint
npm run build
```

Manual smoke:

- `/audit/new` loads categories and devices.
- Selecting Warning/Error shows photo input.
- Submit still calls `submitChecklist`.
- `/audit/scan` can still navigate to a device-prefilled audit URL.

- [ ] **Step 6: Commit Phase 5**

```powershell
git add app/audit/new/page.tsx app/audit/scan/scanner-client.tsx components/checklist/checklist-form.tsx components/checklist/field-audit-card.tsx
git commit -m "feat(ui): add field-first audit experience"
```

---

## Phase 6: Reports And Audit Grid

**Files:**
- Modify: `app/(dashboard)/report/page.tsx`
- Modify: `components/report/report-filters.tsx`
- Modify: `components/report/export-button.tsx`
- Modify: `app/(dashboard)/grid/page.tsx`
- Modify: `components/grid/grid-filters.tsx`

- [ ] **Step 1: Rework reports header and KPI row**

Use `PageHeader`, `StatsCard`, `DataToolbar`, and `StatusBadge`.

Keep current query params:

- `startDate`
- `endDate`
- `incidentStatus`
- `page`

- [ ] **Step 2: Rework compliance table**

Keep columns:

- Status.
- Date & Time.
- Device Name.
- Category.
- Checked By.
- Notes.
- Incident.
- Actions.

Use shared status badge and dense row spacing.

- [ ] **Step 3: Rework report filters/export**

Keep existing filter behavior and export action.

Make filters compact and aligned inside `DataToolbar`.

- [ ] **Step 4: Rework audit grid visual system**

Keep sticky first column and top date row.

Improve:

- Category group headers.
- Today highlighting.
- Empty-cell state.
- Legend for OK/Warning/Error/empty.
- Horizontal scrolling clarity.

- [ ] **Step 5: Verify Phase 6**

Run:

```powershell
npm run lint
npm run build
```

Manual smoke:

- `/report` filters and pagination work.
- Export button remains available.
- Photo modal trigger still opens evidence.
- `/grid` scrolls horizontally and sticky columns remain visible.

- [ ] **Step 6: Commit Phase 6**

```powershell
git add "app/(dashboard)/report/page.tsx" "app/(dashboard)/grid/page.tsx" components/report/report-filters.tsx components/report/export-button.tsx components/grid/grid-filters.tsx
git commit -m "feat(ui): rework reports and audit grid"
```

---

## Phase 7: Admin Inventory Screens

**Files:**
- Modify: `app/(dashboard)/admin/page.tsx`
- Modify: `components/admin/device-table.tsx`
- Modify: `components/admin/add-device-form.tsx`
- Modify: `components/admin/edit-device-form.tsx`
- Modify these related admin tables/forms in the same pass:
  - `components/admin/brand-table.tsx`
  - `components/admin/category-table.tsx`
  - `components/admin/location-table.tsx`
  - `components/admin/rack-table.tsx`
  - `components/admin/user-table.tsx`
  - `components/admin/vlan-table.tsx`

- [ ] **Step 1: Rework admin landing page**

Use `PageHeader`.

Convert quick access cards to compact admin shortcuts grouped by:

- Inventory.
- Infrastructure.
- Governance.

- [ ] **Step 2: Rework `DeviceTable`**

Keep current behavior:

- Search.
- Category/brand/rack/status filters.
- Sorting.
- Toggle active status.
- Takeout from rack.
- Manage remote links.
- QR print modal.
- Edit modal.
- Delete modal.

Change visual pattern only:

- `DataToolbar` for filters.
- `DataTable` for table shell.
- `StatusBadge` for active/inactive.
- Icon buttons with accessible titles.

- [ ] **Step 3: Rework device add/edit forms**

Use `FormSection`.

Keep all field names and actions unchanged.

- [ ] **Step 4: Apply table pattern to related admin tables**

For each related table, apply:

- Shared table wrapper.
- Consistent empty state.
- Consistent icon action sizes.
- Consistent destructive action tone.

- [ ] **Step 5: Verify Phase 7**

Run:

```powershell
npm run lint
npm run build
```

Manual smoke:

- `/admin` device list renders.
- Search/filter/sort still works.
- Add/edit/delete modals open.
- QR print modal opens.
- Active toggle still calls action.

- [ ] **Step 6: Commit Phase 7**

```powershell
git add "app/(dashboard)/admin/page.tsx" components/admin
git commit -m "feat(ui): rework admin inventory screens"
```

---

## Phase 8: Login And Map-Based Site Selection

**Files:**
- Modify: `app/login/page.tsx`
- Modify: `app/select-site/page.tsx`
- Modify: `components/ui/map-selector.tsx`

- [ ] **Step 1: Rework login**

Keep current `login` action and field names:

- `username`
- `password`

Change visual style to operations dark:

- App identity.
- Compact login panel.
- Inline error state.
- Pending button state.

- [ ] **Step 2: Preserve and polish map selection**

In `components/ui/map-selector.tsx`:

- Keep `geoToSvg`.
- Keep Indonesia map image.
- Keep marker click behavior: `switchSite(site.id)` then route to `/checklist`.
- Reduce starfield count or remove starfield if it competes with map readability.
- Replace broad glow blobs with subtle map-focused contrast only.
- Improve marker target size and labels.
- Keep selected-site transition, but make it shorter and less cinematic.

- [ ] **Step 3: Improve fallback list**

In `app/select-site/page.tsx`:

- Keep fallback list for sites without coordinates.
- Make it a clear right-side or bottom panel with title "Sites without map coordinates".
- Keep form action calling `switchSite(site.id)` and `redirect("/checklist")`.

- [ ] **Step 4: Verify Phase 8**

Run:

```powershell
npm run lint
npm run build
```

Manual smoke:

- `/login` submits with existing action.
- `/select-site` shows the map.
- Clicking a map marker selects a site and enters dashboard.
- Sites without coordinates remain selectable.

- [ ] **Step 5: Commit Phase 8**

```powershell
git add app/login/page.tsx app/select-site/page.tsx components/ui/map-selector.tsx
git commit -m "feat(ui): polish login and map site selection"
```

---

## Phase 9: Responsive, Accessibility, And Design Review Pass

**Files:**
- Modify only files touched in previous phases if issues are found.

- [ ] **Step 1: Desktop responsive pass**

Check widths:

- 1440px.
- 1280px.
- 1024px.

Verify:

- Left rail does not crush content.
- Tables scroll instead of overflowing page.
- Page headers do not wrap badly.

- [ ] **Step 2: Mobile responsive pass**

Check widths:

- 390px.
- 430px.
- 768px.

Verify:

- Mobile drawer works.
- Audit touch controls remain usable.
- Buttons do not overflow text.
- Site map remains readable or gracefully scrolls/zooms.

- [ ] **Step 3: Accessibility pass**

Verify:

- Icon-only buttons have `title` or `aria-label`.
- Status badges include text.
- Menus can be closed.
- Focus ring remains visible.
- Inputs have labels.

- [ ] **Step 4: Anti-slop design review**

Inspect all touched screens and remove:

- Decorative gradients/glows that do not support function.
- Nested cards.
- Oversized headings inside dense tools.
- Random colors outside the token set.
- Duplicate navigation.

- [ ] **Step 5: Commit Phase 9 if changes were needed**

```powershell
git add app components lib
git commit -m "fix(ui): tighten responsive and accessibility details"
```

If no changes were needed, do not create an empty commit.

---

## Phase 10: Final Verification And Handoff

**Files:**
- No planned code files.

- [ ] **Step 1: Run full verification**

Run:

```powershell
npm run check
```

Expected:

- ESLint: no errors.
- Vitest: all tests pass.
- Next build: succeeds.

- [ ] **Step 2: Manual smoke checklist**

Verify these flows:

- Login.
- Map-based data center selection.
- Site fallback list.
- Dashboard.
- New audit submit path.
- QR scanner path to prefilled audit.
- Incident list filters.
- Incident detail forms.
- Reports filters and export access.
- Audit grid sticky scroll.
- Admin device table search/filter/sort.
- Add/edit/delete representative admin modal.

- [ ] **Step 3: Confirm no unintended files**

Run:

```powershell
git status --short
git diff --stat origin/main..HEAD
```

Expected:

- Only UI/UX files, tests, and docs changed.
- No `.env`, uploads, backups, database dumps, or `.superpowers/` files tracked.

- [ ] **Step 4: Push when approved**

Run:

```powershell
git push origin main
```

Expected: all phase commits are pushed to `origin/main`.

---

## Spec Coverage Review

- App shell and navigation: Phase 2.
- Dashboard: Phase 3.
- Audit entry and scanner Field-First controls: Phase 5.
- Incident Center list and detail: Phase 4.
- Reports and grid: Phase 6.
- Admin inventory/forms/tables: Phase 7.
- Login and map-based site selection: Phase 8.
- Dark operations design direction and anti-slop rules: Phases 1 and 9.
- Error, empty, pending, responsive, and accessibility states: Phases 1, 7, 9, and 10.
- Verification: Phase 10.
