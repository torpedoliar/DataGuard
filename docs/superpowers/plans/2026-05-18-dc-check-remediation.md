# DC-Check Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the current authorization, site isolation, database setup, seed data, rack/dashboard correctness, and lint blockers found during the repository audit.

**Architecture:** Centralize permission checks in small server-only helpers, then apply them consistently to every server action and page that mutates or reads scoped data. Keep global resources superadmin-only, keep site resources limited to superadmin or the active site's admin, and add focused unit tests for pure rules plus build/lint verification.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict mode, Drizzle ORM with PostgreSQL, ESLint, Vitest.

---

## File Structure

- Create `lib/permissions.ts`: pure role and permission predicates used by server guards and tests.
- Create `lib/action-auth.ts`: server-only action guards around `verifySession()` and `hasAdminAccess()`.
- Create `lib/permissions.test.ts`: unit tests for role rules.
- Create `lib/rack-validation.test.ts`: unit tests for rack U-range collision logic.
- Create `vitest.config.ts`: Node test config with `@/*` alias support.
- Modify `package.json` and `package-lock.json`: add test scripts and Vitest dev dependency.
- Modify `actions/users.ts`, `app/(dashboard)/admin/users/page.tsx`, `components/ui/navbar.tsx`: make user administration superadmin-only.
- Modify `actions/master-data.ts`, `actions/rack-management.ts`, `actions/network.ts`, `actions/checklist.ts`, `app/(dashboard)/admin/devices/[id]/network/page.tsx`: enforce active-site ownership.
- Modify `lib/rack-validation.ts`, `actions/rack-layout.ts`, `actions/dashboard.ts`, `actions/grid.ts`, `actions/report.ts`: fix site filtering and incorrect aggregate data.
- Modify `scripts/seed.ts`, `.env.example`, `README.md`, `AGENTS.md`: align setup docs and seed data with PostgreSQL and multi-site auth.
- Modify lint error files reported by `npm run lint`: remove `any`, fix React compiler violations, and use `const` where required.

---

### Task 1: Add Test Harness and Permission Predicates

**Files:**
- Create: `vitest.config.ts`
- Create: `lib/permissions.ts`
- Create: `lib/permissions.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Install Vitest**

Run:

```bash
npm install -D vitest @vitest/coverage-v8
```

Expected: `package.json` and `package-lock.json` include Vitest packages.

- [ ] **Step 2: Add test scripts**

Modify `package.json` scripts to include:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "check": "npm run lint && npm run test && npm run build"
}
```

- [ ] **Step 3: Create Vitest config**

Create `vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create pure permission helper**

Create `lib/permissions.ts`:

```ts
export type GlobalRole = "superadmin" | "admin" | "staff";
export type SiteRole = "admin" | "staff" | null | undefined;

export function canManageGlobalUsers(role: GlobalRole): boolean {
  return role === "superadmin";
}

export function canManageGlobalSettings(role: GlobalRole): boolean {
  return role === "superadmin";
}

export function canManageGlobalReferenceData(role: GlobalRole): boolean {
  return role === "superadmin";
}

export function canManageActiveSite(role: GlobalRole, roleInSite: SiteRole): boolean {
  return role === "superadmin" || roleInSite === "admin";
}

export function canSubmitChecklist(activeSiteId: number | null | undefined): boolean {
  return typeof activeSiteId === "number";
}
```

- [ ] **Step 5: Add permission tests**

Create `lib/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  canManageActiveSite,
  canManageGlobalReferenceData,
  canManageGlobalSettings,
  canManageGlobalUsers,
  canSubmitChecklist,
} from "./permissions";

describe("permissions", () => {
  it("limits global user administration to superadmin", () => {
    expect(canManageGlobalUsers("superadmin")).toBe(true);
    expect(canManageGlobalUsers("admin")).toBe(false);
    expect(canManageGlobalUsers("staff")).toBe(false);
  });

  it("limits global settings and reference data to superadmin", () => {
    expect(canManageGlobalSettings("superadmin")).toBe(true);
    expect(canManageGlobalSettings("admin")).toBe(false);
    expect(canManageGlobalReferenceData("superadmin")).toBe(true);
    expect(canManageGlobalReferenceData("staff")).toBe(false);
  });

  it("allows active-site management for superadmin or site admin only", () => {
    expect(canManageActiveSite("superadmin", undefined)).toBe(true);
    expect(canManageActiveSite("admin", "admin")).toBe(true);
    expect(canManageActiveSite("admin", "staff")).toBe(false);
    expect(canManageActiveSite("staff", "staff")).toBe(false);
  });

  it("requires an active site before checklist submission", () => {
    expect(canSubmitChecklist(1)).toBe(true);
    expect(canSubmitChecklist(null)).toBe(false);
    expect(canSubmitChecklist(undefined)).toBe(false);
  });
});
```

- [ ] **Step 6: Verify failing tests compile and pass**

Run:

```bash
npm run test
```

Expected: all permission tests pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts lib/permissions.ts lib/permissions.test.ts
git commit -m "test: add permission rule coverage"
```

---

### Task 2: Centralize Server Action Authorization

**Files:**
- Create: `lib/action-auth.ts`
- Modify: `lib/site-access.ts`

- [ ] **Step 1: Create action guard helpers**

Create `lib/action-auth.ts`:

```ts
import "server-only";

import { verifySession } from "@/lib/session";
import { hasAdminAccess } from "@/lib/site-access";

type Session = NonNullable<Awaited<ReturnType<typeof verifySession>>>;

type GuardSuccess = {
  ok: true;
  session: Session;
  activeSiteId: number;
};

type GuardFailure = {
  ok: false;
  message: string;
};

export type ActionGuardResult = GuardSuccess | GuardFailure;

export async function requireSuperadminAction(): Promise<ActionGuardResult> {
  const session = await verifySession();
  if (!session || session.role !== "superadmin") {
    return { ok: false, message: "Unauthorized. Superadmin access required." };
  }
  return { ok: true, session, activeSiteId: session.activeSiteId ?? 0 };
}

export async function requireActiveSiteAction(): Promise<ActionGuardResult> {
  const session = await verifySession();
  if (!session) return { ok: false, message: "Unauthorized." };
  if (!session.activeSiteId) return { ok: false, message: "No active site selected." };
  return { ok: true, session, activeSiteId: session.activeSiteId };
}

export async function requireActiveSiteAdminAction(): Promise<ActionGuardResult> {
  const activeSite = await requireActiveSiteAction();
  if (!activeSite.ok) return activeSite;

  const allowed = await hasAdminAccess();
  if (!allowed) {
    return { ok: false, message: "Unauthorized. Active-site admin access required." };
  }

  return activeSite;
}
```

- [ ] **Step 2: Keep `hasAdminAccess()` as the single site-admin authority**

Review `lib/site-access.ts`. Keep the current behavior: superadmin returns true; regular users require `user_sites.role_in_site = admin` for the active site.

- [ ] **Step 3: Verify TypeScript**

Run:

```bash
npx tsc --noEmit
```

Expected: command exits with code 0.

- [ ] **Step 4: Commit**

```bash
git add lib/action-auth.ts lib/site-access.ts
git commit -m "feat: add server action authorization guards"
```

---

### Task 3: Make User Administration Superadmin-Only

**Files:**
- Modify: `actions/users.ts`
- Modify: `app/(dashboard)/admin/users/page.tsx`
- Modify: `components/ui/navbar.tsx`

- [ ] **Step 1: Replace user action role checks**

In `actions/users.ts`, import:

```ts
import { requireSuperadminAction } from "../lib/action-auth";
```

For `getUsers`, `createUser`, `updateUser`, `deleteUser`, and `adminResetPassword`, replace the existing `["admin", "superadmin"].includes(session.role)` check with:

```ts
const auth = await requireSuperadminAction();
if (!auth.ok) return { message: auth.message };
```

For `getUsers()`, return an empty array on failure:

```ts
const auth = await requireSuperadminAction();
if (!auth.ok) return [];
```

- [ ] **Step 2: Restrict the users page**

In `app/(dashboard)/admin/users/page.tsx`, change the guard to:

```ts
if (!session || session.role !== "superadmin") redirect("/checklist");
```

- [ ] **Step 3: Hide Users link from non-superadmin navigation**

In `components/ui/navbar.tsx`, remove `{ href: "/admin/users", icon: "group", label: "Users" }` from the shared admin menu array. Add it inside the existing `user.role === "superadmin"` block:

```tsx
<Link
  href="/admin/users"
  onClick={() => setShowAdminMenu(false)}
  className={`flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors ${isActive("/admin/users") ? "text-blue-400 bg-blue-500/5" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}
>
  <span className="material-symbols-outlined text-[16px]">group</span>
  Users
</Link>
```

- [ ] **Step 4: Verify**

Run:

```bash
npm run test
npx tsc --noEmit
```

Expected: tests and typecheck pass. Manual check: a non-superadmin admin cannot see or open `/admin/users`.

- [ ] **Step 5: Commit**

```bash
git add actions/users.ts app/(dashboard)/admin/users/page.tsx components/ui/navbar.tsx
git commit -m "fix(auth): restrict user administration to superadmin"
```

---

### Task 4: Enforce Active-Site Ownership on Inventory, Rack, Checklist, and Network Actions

**Files:**
- Modify: `actions/master-data.ts`
- Modify: `actions/rack-management.ts`
- Modify: `actions/network.ts`
- Modify: `actions/checklist.ts`
- Modify: `app/(dashboard)/admin/devices/[id]/network/page.tsx`

- [ ] **Step 1: Apply active-site admin guard to site-scoped mutations**

In `actions/master-data.ts`, import:

```ts
import { and } from "drizzle-orm";
import { requireActiveSiteAdminAction } from "../lib/action-auth";
```

At the start of device mutation functions, use:

```ts
const auth = await requireActiveSiteAdminAction();
if (!auth.ok) return { message: auth.message };
```

Use `auth.activeSiteId` for inserts:

```ts
siteId: auth.activeSiteId,
```

- [ ] **Step 2: Scope device lookup and updates by active site**

Replace device lookup by ID with:

```ts
const existingDevice = await db.query.devices.findFirst({
  where: and(eq(devices.id, id), eq(devices.siteId, auth.activeSiteId)),
});
if (!existingDevice) return { message: "Perangkat tidak ditemukan di site aktif." };
```

Replace update/delete/toggle/takeout `where(eq(devices.id, id))` with:

```ts
where(and(eq(devices.id, id), eq(devices.siteId, auth.activeSiteId)))
```

- [ ] **Step 3: Scope rack CRUD by active site**

In `actions/rack-management.ts`, apply `requireActiveSiteAdminAction()` to `addRack`, `updateRack`, and `deleteRack`. Use:

```ts
where(and(eq(racks.id, id), eq(racks.siteId, auth.activeSiteId)))
```

for update and delete.

- [ ] **Step 4: Scope checklist ownership by active site**

In `actions/checklist.ts`, make `submitChecklist` require an active site:

```ts
const auth = await requireActiveSiteAction();
if (!auth.ok) return { message: auth.message };
```

Use `auth.activeSiteId` in `checklistEntries.siteId`. For edit/delete queries, include active site:

```ts
where: and(eq(checklistEntries.id, entryId), eq(checklistEntries.siteId, auth.activeSiteId))
```

Keep owner-or-admin behavior, but for admin use `hasAdminAccess()` rather than global role alone.

- [ ] **Step 5: Scope network page device query**

In `app/(dashboard)/admin/devices/[id]/network/page.tsx`, change the device query where clause to:

```ts
.where(and(eq(devices.id, deviceId), eq(devices.siteId, session.activeSiteId)))
```

Import `and` from `drizzle-orm`.

- [ ] **Step 6: Scope VLAN and port actions**

In `actions/network.ts`, apply `requireActiveSiteAdminAction()` to all VLAN/port mutations. For VLAN update/delete:

```ts
where(and(eq(vlans.id, id), eq(vlans.siteId, auth.activeSiteId)))
```

For `getPortsByDevice(deviceId)`, first verify the device belongs to the active site:

```ts
const auth = await requireActiveSiteAction();
if (!auth.ok) return [];

const [device] = await db
  .select({ id: devices.id })
  .from(devices)
  .where(and(eq(devices.id, deviceId), eq(devices.siteId, auth.activeSiteId)))
  .limit(1);

if (!device) return [];
```

- [ ] **Step 7: Verify**

Run:

```bash
npx tsc --noEmit
npm run build
```

Expected: both commands pass. Manual check: an admin assigned to Site A cannot mutate a direct URL or server action payload for Site B records.

- [ ] **Step 8: Commit**

```bash
git add actions/master-data.ts actions/rack-management.ts actions/network.ts actions/checklist.ts app/(dashboard)/admin/devices/[id]/network/page.tsx
git commit -m "fix(auth): enforce active-site ownership on mutations"
```

---

### Task 5: Fix Rack Collision and Rack Statistics

**Files:**
- Modify: `lib/rack-validation.ts`
- Create: `lib/rack-validation.test.ts`
- Modify: `actions/master-data.ts`
- Modify: `actions/rack-management.ts`
- Modify: `actions/rack-layout.ts`

- [ ] **Step 1: Extract pure range collision helper**

Add this to `lib/rack-validation.ts`:

```ts
export type RackRange = {
  rackPosition: number;
  uHeight: number | null;
};

export function rackRangesOverlap(
  proposed: RackRange,
  existing: RackRange
): boolean {
  const proposedStart = proposed.rackPosition;
  const proposedEnd = proposed.rackPosition + (proposed.uHeight || 1) - 1;
  const existingStart = existing.rackPosition;
  const existingEnd = existing.rackPosition + (existing.uHeight || 1) - 1;

  return Math.max(proposedStart, existingStart) <= Math.min(proposedEnd, existingEnd);
}
```

- [ ] **Step 2: Add rack collision tests**

Create `lib/rack-validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rackRangesOverlap } from "./rack-validation";

describe("rackRangesOverlap", () => {
  it("detects overlapping U ranges", () => {
    expect(
      rackRangesOverlap(
        { rackPosition: 10, uHeight: 2 },
        { rackPosition: 11, uHeight: 1 }
      )
    ).toBe(true);
  });

  it("allows adjacent U ranges", () => {
    expect(
      rackRangesOverlap(
        { rackPosition: 10, uHeight: 2 },
        { rackPosition: 12, uHeight: 1 }
      )
    ).toBe(false);
  });
});
```

- [ ] **Step 3: Add site ID to collision query**

Change `checkRackCollision` signature in `lib/rack-validation.ts`:

```ts
export async function checkRackCollision(
  siteId: number,
  rackName: string,
  rackPosition: number,
  uHeight: number = 1,
  excludeDeviceId?: number
) {
```

Add `eq(devices.siteId, siteId)` to the conditions array:

```ts
const conditions = [
  eq(devices.siteId, siteId),
  eq(devices.rackName, rackName),
  isNotNull(devices.rackPosition),
];
```

Use `rackRangesOverlap()` inside the loop.

- [ ] **Step 4: Update callers**

In `actions/master-data.ts`, call:

```ts
await checkRackCollision(
  auth.activeSiteId,
  parsed.data.rackName,
  parsed.data.rackPosition,
  parsed.data.uHeight || 1,
  id
);
```

In `actions/rack-management.ts`, update `getOccupiedSlots` conditions to include:

```ts
eq(devices.siteId, session.activeSiteId)
```

- [ ] **Step 5: Correct rack stats**

In `actions/rack-layout.ts`, import `and` and `isNotNull`. Change `devicesWithRack` query to:

```ts
.where(and(
  siteId ? eq(devices.siteId, siteId) : undefined,
  isNotNull(devices.rackName),
  isNotNull(devices.rackPosition)
))
```

Add the same site filter to `devicesByZone` and `devicesByCategory` before `groupBy()`.

- [ ] **Step 6: Verify**

Run:

```bash
npm run test
npm run build
```

Expected: tests and build pass. Manual check: same rack name in two sites no longer blocks placement across sites.

- [ ] **Step 7: Commit**

```bash
git add lib/rack-validation.ts lib/rack-validation.test.ts actions/master-data.ts actions/rack-management.ts actions/rack-layout.ts
git commit -m "fix(rack): scope collision and stats to active site"
```

---

### Task 6: Fix Dashboard, Grid, and Report Data Scope

**Files:**
- Modify: `actions/dashboard.ts`
- Modify: `actions/grid.ts`
- Modify: `actions/report.ts`

- [ ] **Step 1: Fix dashboard category totals**

In `actions/dashboard.ts`, change category device count to include site:

```ts
.where(and(
  eq(devices.categoryId, cat.id),
  siteId ? eq(devices.siteId, siteId) : undefined
))
```

- [ ] **Step 2: Fix grid checklist item scope**

In `actions/grid.ts`, add active site filtering to the checklist item query:

```ts
where(and(
  gte(checklistEntries.checkDate, startBoundary),
  lte(checklistEntries.checkDate, endBoundary),
  siteId ? eq(checklistEntries.siteId, siteId) : undefined
))
```

- [ ] **Step 3: Fix report location source**

In `actions/report.ts`, import `locations`, join it, and select the normalized location name:

```ts
import { checklistEntries, checklistItems, devices, locations } from "../db/schema";
```

Use:

```ts
.leftJoin(locations, eq(devices.locationId, locations.id))
```

and replace:

```ts
location: devices.location,
```

with:

```ts
location: locations.name,
```

in both report queries.

- [ ] **Step 4: Verify**

Run:

```bash
npx tsc --noEmit
npm run build
```

Expected: both commands pass. Manual check: dashboard category totals, grid cells, and report rows only reflect the active site.

- [ ] **Step 5: Commit**

```bash
git add actions/dashboard.ts actions/grid.ts actions/report.ts
git commit -m "fix(reports): scope analytics and reports to active site"
```

---

### Task 7: Align Database Migrations, Seed Data, and Documentation

**Files:**
- Modify: `drizzle/`
- Modify: `scripts/seed.ts`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Regenerate PostgreSQL migrations from current schema**

Run:

```bash
npm run db:generate
```

Expected: generated migration SQL uses PostgreSQL syntax such as `serial`, `timestamp`, `boolean`, and enum creation. Remove stale SQLite migration files that contain `AUTOINCREMENT`, `strftime`, or backtick-delimited table names after the new PostgreSQL migration set exists.

- [ ] **Step 2: Update `scripts/seed.ts`**

Replace the current seed script behavior with the `seed-users.ts` pattern: create `admin` as `superadmin`, create `staff`, create `Data Center Jakarta (Demo)`, and assign both users to the site. Ensure inserted devices include `siteId: defaultSite.id`.

Use this values pattern for seeded devices:

```ts
{
  siteId: defaultSite.id,
  categoryId: serverCat.id,
  name: "Server APP-01",
  location: "Rack A-01",
}
```

- [ ] **Step 3: Update `.env.example` for PostgreSQL**

Replace SQLite config with:

```env
# Database Configuration
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dccheck

# Authentication - Generate a random secret key (min 32 characters)
SESSION_SECRET=your-secret-key-min-32-characters-long

# File Upload Configuration
UPLOAD_DIR=./public/uploads
MAX_FILE_SIZE=5242880
```

- [ ] **Step 4: Update documentation**

In `README.md`, replace SQLite references with PostgreSQL references in the tech stack, environment variables, backup section, and project structure. In `AGENTS.md`, keep the existing PostgreSQL note and remove any SQLite language if present.

- [ ] **Step 5: Verify migration setup**

Run against a local PostgreSQL database:

```bash
npm run db:migrate
npm run seed
npm run build
```

Expected: migrations apply, seed creates at least one active site, and seeded `admin/password` can reach `/select-site` then `/checklist`.

- [ ] **Step 6: Commit**

```bash
git add drizzle scripts/seed.ts .env.example README.md AGENTS.md
git commit -m "fix(db): align migrations and seed data with postgres"
```

---

### Task 8: Clear Lint Errors Without Weakening Rules

**Files:**
- Modify: files reported by `npm run lint`

- [ ] **Step 1: Fix automatic prefer-const errors**

Run:

```bash
npx eslint --fix actions/grid.ts actions/rack-layout.ts actions/settings.ts
```

Expected: `prefer-const` errors are fixed.

- [ ] **Step 2: Replace `any` in action catch blocks**

Use this pattern in `actions/brands.ts`, `actions/settings.ts`, `actions/sites.ts`, and `actions/network.ts`:

```ts
function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
```

Then replace `catch (err: any)` with `catch (error: unknown)` and use:

```ts
return { message: getErrorMessage(error, "Gagal memproses file. Silakan coba lagi.") };
```

- [ ] **Step 3: Replace uppercase inline sort components**

In `components/admin/brand-table.tsx`, `location-table.tsx`, `user-table.tsx`, and `vlan-table.tsx`, replace inline `const SortIcon = ...` components with lowercase render helpers:

```tsx
const renderSortIcon = (col: SortKey) => {
  if (sortKey !== col) return <ArrowUpDown className="h-3.5 w-3.5 text-slate-600" />;
  return sortDir === "asc"
    ? <ArrowUp className="h-3.5 w-3.5 text-blue-400" />
    : <ArrowDown className="h-3.5 w-3.5 text-blue-400" />;
};
```

Use it as:

```tsx
{renderSortIcon("name")}
```

- [ ] **Step 4: Fix direct setState-in-effect errors**

For `components/admin/device-health-trend.tsx`, remove the direct `setIsLoading(true)` from the effect body and initialize loading state from dependencies:

```tsx
const [isLoading, setIsLoading] = useState(true);

useEffect(() => {
  let cancelled = false;
  getDeviceHealthHistory(deviceId, days).then((data) => {
    if (cancelled) return;
    setHistory(data);
    setIsLoading(false);
  });
  return () => {
    cancelled = true;
  };
}, [deviceId, days]);
```

For form reset effects that still trigger lint, move reset logic into the submit success path with a client wrapper action instead of setting state directly inside `useEffect`.

- [ ] **Step 5: Run lint**

Run:

```bash
npm run lint
```

Expected: 0 errors. Remaining warnings should be reviewed and either fixed or documented in the commit body.

- [ ] **Step 6: Commit**

```bash
git add actions components db lib scripts app
git commit -m "chore: clear lint blockers"
```

---

### Task 9: Final Verification and Regression Pass

**Files:**
- No planned source changes unless verification finds a regression.

- [ ] **Step 1: Run full automated checks**

Run:

```bash
npm run check
npx tsc --noEmit
```

Expected: lint, tests, build, and typecheck pass.

- [ ] **Step 2: Run manual RBAC scenarios**

Verify these flows in the browser:

```text
superadmin: can switch sites, manage users, manage sites, manage settings
site admin: can manage devices/racks/VLANs only in active assigned site
site admin: cannot access /admin/users
staff: can submit checklist in active site
staff: cannot access admin routes
```

- [ ] **Step 3: Run manual data isolation scenarios**

Create two sites with the same rack name. Verify:

```text
device placement in Site A does not collide with Site B
dashboard totals change when switching active site
grid and reports only show active-site checklist rows
network page rejects devices outside active site
```

- [ ] **Step 4: Commit verification notes**

If manual verification required small fixes, commit them:

```bash
git add .
git commit -m "fix: address remediation verification findings"
```

If no changes were needed, add the verification notes to the pull request body instead of creating an empty commit.

---

## Self-Review

- Spec coverage: the plan covers RBAC escalation, active-site isolation, stale database setup, stale seed data, rack collision/stats, dashboard/grid/report scope, and lint failure.
- Placeholder scan: no task depends on an undefined future decision; each code-changing area includes exact files, commands, and concrete snippets.
- Type consistency: role names match `db/schema.ts`; guard functions consistently return `{ ok, session, activeSiteId }`; active-site checks use `session.activeSiteId` and Drizzle `and(eq(...), eq(...))`.
