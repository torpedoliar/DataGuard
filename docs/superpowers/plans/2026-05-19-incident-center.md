# Incident Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Incident Center that converts checklist `Warning` and `Error` items into assigned, SLA-tracked, evidence-backed operational incidents.

**Architecture:** Add incident domain rules in `lib/`, persist incidents through Drizzle tables, create server actions in `actions/incidents.ts`, and expose list/detail workflows through the existing dashboard route group. Checklist submission creates incidents automatically; dashboard/report queries join incident state where needed.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Drizzle ORM, PostgreSQL, Vitest, Tailwind CSS v4, existing JWT session/RBAC helpers, existing Telegram helper.

---

## File Structure

- Create `lib/incidents.ts`: pure incident status, severity, SLA, recurring, and permission helpers.
- Create `lib/incidents.test.ts`: Vitest coverage for domain rules.
- Create `lib/upload.ts`: server-only upload helper for incident evidence photos.
- Modify `db/schema.ts`: incident enums, `incidents`, `incidentUpdates`, and relations.
- Create `actions/incidents.ts`: incident queries, mutations, auto-create service, and Telegram notifications.
- Modify `actions/checklist.ts`: call incident auto-creation after checklist item insert.
- Modify `actions/dashboard.ts`: return incident KPI counts.
- Modify `actions/report.ts`: filter/export incident status.
- Modify `lib/audit.ts`: add `incident` audit entity.
- Create `components/admin/incident-table.tsx`: list table and filters.
- Create `components/admin/incident-detail.tsx`: detail shell and timeline.
- Create `components/admin/incident-assignment-form.tsx`: admin assignment/severity/due-date form.
- Create `components/admin/incident-status-form.tsx`: status transition and resolution form.
- Create `components/admin/incident-update-form.tsx`: comment/evidence upload form.
- Create `app/(dashboard)/admin/incidents/page.tsx`: active-site incident list page.
- Create `app/(dashboard)/admin/incidents/[id]/page.tsx`: active-site incident detail page.
- Modify `components/ui/navbar.tsx`: add Incident Center navigation.
- Modify `app/(dashboard)/checklist/page.tsx`: add incident KPI cards.
- Modify `components/report/report-filters.tsx` and `components/report/export-button.tsx`: include incident status.
- Create `scripts/notify-overdue-incidents.ts`: cron/Task Scheduler friendly overdue Telegram notification.
- Modify `package.json`: add `incidents:notify-overdue`.
- Generate a Drizzle migration under `drizzle/`.

---

### Task 1: Incident Domain Rules

**Files:**
- Create: `lib/incidents.ts`
- Create: `lib/incidents.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/incidents.test.ts
import { describe, expect, it } from "vitest";
import {
  canTransitionIncidentStatus,
  calculateIncidentDueDate,
  getDefaultIncidentSeverity,
  isRecurringIncident,
} from "./incidents";

describe("incident domain rules", () => {
  it("maps checklist statuses to default incident severity", () => {
    expect(getDefaultIncidentSeverity("OK")).toBeNull();
    expect(getDefaultIncidentSeverity("Warning")).toBe("Medium");
    expect(getDefaultIncidentSeverity("Error")).toBe("High");
  });

  it("calculates SLA due dates by severity", () => {
    const base = new Date("2026-05-19T00:00:00.000Z");

    expect(calculateIncidentDueDate("Low", base).toISOString()).toBe("2026-05-26T00:00:00.000Z");
    expect(calculateIncidentDueDate("Medium", base).toISOString()).toBe("2026-05-22T00:00:00.000Z");
    expect(calculateIncidentDueDate("High", base).toISOString()).toBe("2026-05-20T00:00:00.000Z");
    expect(calculateIncidentDueDate("Critical", base).toISOString()).toBe("2026-05-19T04:00:00.000Z");
  });

  it("limits status transitions by role and assignment", () => {
    expect(canTransitionIncidentStatus({ isAdmin: false, isAssignee: true, current: "Open", next: "In Progress" })).toBe(true);
    expect(canTransitionIncidentStatus({ isAdmin: false, isAssignee: true, current: "In Progress", next: "Resolved" })).toBe(true);
    expect(canTransitionIncidentStatus({ isAdmin: false, isAssignee: true, current: "Resolved", next: "Verified" })).toBe(false);
    expect(canTransitionIncidentStatus({ isAdmin: true, isAssignee: false, current: "Resolved", next: "Verified" })).toBe(true);
    expect(canTransitionIncidentStatus({ isAdmin: true, isAssignee: false, current: "Verified", next: "Open" })).toBe(true);
  });

  it("flags recurring device incidents after multiple recent incidents", () => {
    expect(isRecurringIncident(0)).toBe(false);
    expect(isRecurringIncident(1)).toBe(false);
    expect(isRecurringIncident(2)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `npm run test -- lib/incidents.test.ts`

Expected: FAIL because `lib/incidents.ts` does not exist.

- [ ] **Step 3: Implement pure helpers**

```ts
// lib/incidents.ts
export type ChecklistStatus = "OK" | "Warning" | "Error";
export type IncidentSeverity = "Low" | "Medium" | "High" | "Critical";
export type IncidentStatus = "Open" | "In Progress" | "Resolved" | "Verified";
export type ResolutionCategory =
  | "Hardware"
  | "Power"
  | "Network"
  | "Environment"
  | "Human Error"
  | "False Alarm"
  | "Other";
export type ResolutionAction =
  | "Replaced"
  | "Reconfigured"
  | "Restarted"
  | "Cleaned"
  | "Escalated"
  | "No Action Needed";

export function getDefaultIncidentSeverity(status: ChecklistStatus): IncidentSeverity | null {
  if (status === "Warning") return "Medium";
  if (status === "Error") return "High";
  return null;
}

export function calculateIncidentDueDate(severity: IncidentSeverity, base = new Date()): Date {
  const due = new Date(base);
  if (severity === "Critical") {
    due.setHours(due.getHours() + 4);
    return due;
  }

  const daysBySeverity: Record<Exclude<IncidentSeverity, "Critical">, number> = {
    Low: 7,
    Medium: 3,
    High: 1,
  };
  due.setDate(due.getDate() + daysBySeverity[severity]);
  return due;
}

export function canTransitionIncidentStatus(input: {
  isAdmin: boolean;
  isAssignee: boolean;
  current: IncidentStatus;
  next: IncidentStatus;
}): boolean {
  if (input.current === input.next) return true;
  if (input.isAdmin) {
    if (input.current === "Verified") return input.next === "Open";
    return true;
  }
  if (!input.isAssignee) return false;

  const staffTransitions: Record<IncidentStatus, IncidentStatus[]> = {
    Open: ["In Progress"],
    "In Progress": ["Resolved"],
    Resolved: [],
    Verified: [],
  };
  return staffTransitions[input.current].includes(input.next);
}

export function isRecurringIncident(recentDeviceIncidentCount: number): boolean {
  return recentDeviceIncidentCount >= 2;
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npm run test -- lib/incidents.test.ts`

Expected: PASS.

Commit:

```bash
git add lib/incidents.ts lib/incidents.test.ts
git commit -m "feat: add incident domain rules"
```

---

### Task 2: Database Schema and Migration

**Files:**
- Modify: `db/schema.ts`
- Generated: `drizzle/*.sql`
- Generated: `drizzle/meta/*.json`

- [ ] **Step 1: Add schema definitions**

Add `uniqueIndex` to the `pg-core` import:

```ts
import { integer, pgTable, text, serial, boolean, timestamp, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
```

Add enums near the existing enums:

```ts
export const incidentSeverityEnum = pgEnum("incident_severity", ["Low", "Medium", "High", "Critical"]);
export const incidentStatusEnum = pgEnum("incident_status", ["Open", "In Progress", "Resolved", "Verified"]);
export const incidentUpdateTypeEnum = pgEnum("incident_update_type", ["created", "assigned", "status_changed", "comment", "evidence"]);
export const resolutionCategoryEnum = pgEnum("resolution_category", ["Hardware", "Power", "Network", "Environment", "Human Error", "False Alarm", "Other"]);
export const resolutionActionEnum = pgEnum("resolution_action", ["Replaced", "Reconfigured", "Restarted", "Cleaned", "Escalated", "No Action Needed"]);
```

Add tables after `checklistItems`:

```ts
export const incidents = pgTable("incidents", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id).notNull(),
  deviceId: integer("device_id").references(() => devices.id).notNull(),
  checklistItemId: integer("checklist_item_id").references(() => checklistItems.id),
  title: text("title").notNull(),
  description: text("description"),
  severity: incidentSeverityEnum("severity").notNull().default("Medium"),
  status: incidentStatusEnum("status").notNull().default("Open"),
  createdById: integer("created_by_id").references(() => users.id),
  assignedToId: integer("assigned_to_id").references(() => users.id),
  dueDate: timestamp("due_date"),
  resolutionCategory: resolutionCategoryEnum("resolution_category"),
  resolutionAction: resolutionActionEnum("resolution_action"),
  resolvedById: integer("resolved_by_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  verifiedById: integer("verified_by_id").references(() => users.id),
  verifiedAt: timestamp("verified_at"),
  lastOverdueNotifiedAt: timestamp("last_overdue_notified_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  checklistItemUnique: uniqueIndex("incidents_checklist_item_id_unique").on(table.checklistItemId),
}));

export const incidentUpdates = pgTable("incident_updates", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").references(() => incidents.id).notNull(),
  authorId: integer("author_id").references(() => users.id),
  updateType: incidentUpdateTypeEnum("update_type").notNull(),
  note: text("note"),
  photoPath: text("photo_path"),
  previousStatus: incidentStatusEnum("previous_status"),
  newStatus: incidentStatusEnum("new_status"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

Add relations:

```ts
export const incidentsRelations = relations(incidents, ({ one, many }) => ({
  site: one(sites, { fields: [incidents.siteId], references: [sites.id] }),
  device: one(devices, { fields: [incidents.deviceId], references: [devices.id] }),
  checklistItem: one(checklistItems, { fields: [incidents.checklistItemId], references: [checklistItems.id] }),
  createdBy: one(users, { fields: [incidents.createdById], references: [users.id], relationName: "createdIncidents" }),
  assignedTo: one(users, { fields: [incidents.assignedToId], references: [users.id], relationName: "assignedIncidents" }),
  updates: many(incidentUpdates),
}));

export const incidentUpdatesRelations = relations(incidentUpdates, ({ one }) => ({
  incident: one(incidents, { fields: [incidentUpdates.incidentId], references: [incidents.id] }),
  author: one(users, { fields: [incidentUpdates.authorId], references: [users.id] }),
}));
```

Extend existing relation blocks:

```ts
// sitesRelations
incidents: many(incidents),

// usersRelations
createdIncidents: many(incidents, { relationName: "createdIncidents" }),
assignedIncidents: many(incidents, { relationName: "assignedIncidents" }),

// devicesRelations
incidents: many(incidents),

// checklistItemsRelations
incident: one(incidents, {
  fields: [checklistItems.id],
  references: [incidents.checklistItemId],
}),
```

- [ ] **Step 2: Typecheck schema**

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Generate migration**

Run: `npm run db:generate`

Expected: one new migration SQL file under `drizzle/` and updated Drizzle meta snapshots.

- [ ] **Step 4: Commit**

```bash
git add db/schema.ts drizzle
git commit -m "feat: add incident database schema"
```

---

### Task 3: Upload Helper and Audit Entity

**Files:**
- Create: `lib/upload.ts`
- Modify: `lib/audit.ts`

- [ ] **Step 1: Create upload helper**

```ts
// lib/upload.ts
import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

export async function saveUploadFile(file: File, prefix: string): Promise<string | null> {
  if (!file || file.size === 0 || file.name === "undefined") return null;

  const buffer = Buffer.from(await file.arrayBuffer());
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  const fileName = `${prefix}-${timestamp}-${safeName}`;
  const uploadDir = path.join(process.cwd(), "public/uploads");

  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, fileName), buffer);

  return `/uploads/${fileName}`;
}
```

- [ ] **Step 2: Add audit entity**

Extend `AuditEntity` in `lib/audit.ts`:

```ts
export type AuditEntity =
    | "device"
    | "brand"
    | "category"
    | "location"
    | "rack"
    | "user"
    | "vlan"
    | "network_port"
    | "checklist"
    | "incident"
    | "settings"
    | "site"
    | "user_site"
    | "session";
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit`

Expected: PASS.

Commit:

```bash
git add lib/upload.ts lib/audit.ts
git commit -m "feat: add incident upload support"
```

---

### Task 4: Incident Server Actions

**Files:**
- Create: `actions/incidents.ts`

- [ ] **Step 1: Create core action file**

```ts
// actions/incidents.ts
"use server";

import { db } from "@/db";
import { devices, incidentUpdates, incidents, sites, userSites, users } from "@/db/schema";
import { requireActiveSiteAction, requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import {
  calculateIncidentDueDate,
  canTransitionIncidentStatus,
  getDefaultIncidentSeverity,
  type ChecklistStatus,
  type IncidentSeverity,
  type IncidentStatus,
  type ResolutionAction,
  type ResolutionCategory,
} from "@/lib/incidents";
import { saveUploadFile } from "@/lib/upload";
import { hasAdminAccess } from "@/lib/site-access";
import { sendTelegramAlert } from "@/lib/telegram";
import { and, asc, desc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
```

- [ ] **Step 2: Add query types and recurring helper**

```ts
export type IncidentListFilters = {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  assigneeId?: number;
  due?: "overdue" | "today";
};

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

async function getRecurringDeviceCounts(siteId: number, deviceIds: number[]) {
  if (deviceIds.length === 0) return new Map<number, number>();

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const rows = await db.select({
    deviceId: incidents.deviceId,
    count: sql<number>`count(*)`,
  })
    .from(incidents)
    .where(and(
      eq(incidents.siteId, siteId),
      inArray(incidents.deviceId, deviceIds),
      gte(incidents.createdAt, since),
    ))
    .groupBy(incidents.deviceId);

  return new Map(rows.map((row) => [row.deviceId, Number(row.count)]));
}
```

- [ ] **Step 3: Add list/detail/stat queries**

```ts
export async function getIncidentStats() {
  const auth = await requireActiveSiteAction();
  if (!auth.ok) return { open: 0, critical: 0, dueToday: 0, overdue: 0 };

  const todayStart = startOfToday();
  const todayEnd = endOfToday();

  const [open, critical, dueToday, overdue] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(incidents)
      .where(and(eq(incidents.siteId, auth.activeSiteId), ne(incidents.status, "Verified"))),
    db.select({ count: sql<number>`count(*)` }).from(incidents)
      .where(and(eq(incidents.siteId, auth.activeSiteId), eq(incidents.severity, "Critical"), ne(incidents.status, "Verified"))),
    db.select({ count: sql<number>`count(*)` }).from(incidents)
      .where(and(eq(incidents.siteId, auth.activeSiteId), gte(incidents.dueDate, todayStart), lt(incidents.dueDate, todayEnd), ne(incidents.status, "Verified"))),
    db.select({ count: sql<number>`count(*)` }).from(incidents)
      .where(and(eq(incidents.siteId, auth.activeSiteId), lt(incidents.dueDate, new Date()), ne(incidents.status, "Verified"))),
  ]);

  return {
    open: Number(open[0]?.count ?? 0),
    critical: Number(critical[0]?.count ?? 0),
    dueToday: Number(dueToday[0]?.count ?? 0),
    overdue: Number(overdue[0]?.count ?? 0),
  };
}

export async function getIncidents(filters: IncidentListFilters = {}) {
  const auth = await requireActiveSiteAction();
  if (!auth.ok) return [];

  const canAdminister = await hasAdminAccess();
  const conditions = [eq(incidents.siteId, auth.activeSiteId)];

  if (!canAdminister) {
    conditions.push(or(eq(incidents.createdById, auth.session.userId), eq(incidents.assignedToId, auth.session.userId))!);
  }
  if (filters.status) conditions.push(eq(incidents.status, filters.status));
  if (filters.severity) conditions.push(eq(incidents.severity, filters.severity));
  if (filters.assigneeId) conditions.push(eq(incidents.assignedToId, filters.assigneeId));
  if (filters.due === "overdue") conditions.push(and(lt(incidents.dueDate, new Date()), ne(incidents.status, "Verified"))!);
  if (filters.due === "today") conditions.push(and(gte(incidents.dueDate, startOfToday()), lt(incidents.dueDate, endOfToday()))!);

  const rows = await db.select({
    id: incidents.id,
    title: incidents.title,
    severity: incidents.severity,
    status: incidents.status,
    dueDate: incidents.dueDate,
    createdAt: incidents.createdAt,
    deviceId: incidents.deviceId,
    deviceName: devices.name,
    assignee: users.username,
  })
    .from(incidents)
    .innerJoin(devices, eq(incidents.deviceId, devices.id))
    .leftJoin(users, eq(incidents.assignedToId, users.id))
    .where(and(...conditions))
    .orderBy(desc(incidents.createdAt));

  const recurringCounts = await getRecurringDeviceCounts(auth.activeSiteId, rows.map((row) => row.deviceId));
  return rows.map((row) => ({ ...row, isRecurring: (recurringCounts.get(row.deviceId) ?? 0) >= 2 }));
}

export async function getIncidentDetail(incidentId: number) {
  const auth = await requireActiveSiteAction();
  if (!auth.ok) return null;

  const incident = await db.query.incidents.findFirst({
    where: and(eq(incidents.id, incidentId), eq(incidents.siteId, auth.activeSiteId)),
    with: { device: true, assignedTo: true, createdBy: true, updates: { with: { author: true } } },
  });
  if (!incident) return null;

  const canAdminister = await hasAdminAccess();
  const canView = canAdminister || incident.createdById === auth.session.userId || incident.assignedToId === auth.session.userId;
  if (!canView) return null;

  const recurringCounts = await getRecurringDeviceCounts(auth.activeSiteId, [incident.deviceId]);
  return { ...incident, isRecurring: (recurringCounts.get(incident.deviceId) ?? 0) >= 2 };
}

export async function getAssignableIncidentUsers() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return [];

  return await db.select({
    id: users.id,
    username: users.username,
  })
    .from(users)
    .innerJoin(userSites, eq(userSites.userId, users.id))
    .where(and(eq(userSites.siteId, auth.activeSiteId), eq(users.isActive, true)))
    .orderBy(asc(users.username));
}
```

- [ ] **Step 4: Add auto-create service**

```ts
export async function createIncidentsForChecklistItems(input: {
  siteId: number;
  userId: number;
  items: Array<{
    checklistItemId: number;
    deviceId: number;
    status: ChecklistStatus;
    remarks: string;
  }>;
}) {
  const incidentItems = input.items
    .map((item) => ({ ...item, severity: getDefaultIncidentSeverity(item.status) }))
    .filter((item): item is typeof item & { severity: IncidentSeverity } => item.severity !== null);

  if (incidentItems.length === 0) return [];

  const deviceRows = await db.query.devices.findMany({
    where: and(eq(devices.siteId, input.siteId), inArray(devices.id, incidentItems.map((item) => item.deviceId))),
  });
  const deviceById = new Map(deviceRows.map((device) => [device.id, device]));

  const created = [];
  for (const item of incidentItems) {
    const device = deviceById.get(item.deviceId);
    if (!device) continue;

    const [incident] = await db.insert(incidents).values({
      siteId: input.siteId,
      deviceId: item.deviceId,
      checklistItemId: item.checklistItemId,
      title: `${item.status}: ${device.name}`,
      description: item.remarks,
      severity: item.severity,
      status: "Open",
      createdById: input.userId,
      dueDate: calculateIncidentDueDate(item.severity),
    }).onConflictDoNothing().returning();

    if (!incident) continue;

    await db.insert(incidentUpdates).values({
      incidentId: incident.id,
      authorId: input.userId,
      updateType: "created",
      note: `Created from checklist item #${item.checklistItemId}`,
      newStatus: "Open",
    });

    created.push(incident);
  }

  await notifyCriticalIncidents(input.siteId, created.filter((incident) => incident.severity === "Critical"));
  return created;
}
```

- [ ] **Step 5: Add mutations and notifications**

```ts
async function notifyCriticalIncidents(siteId: number, criticalIncidents: Array<typeof incidents.$inferSelect>) {
  if (criticalIncidents.length === 0) return;

  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  if (!site?.telegramChatId) return;

  const message = [
    "*Critical Incident Opened*",
    `Site: ${site.name}`,
    ...criticalIncidents.map((incident) => `#${incident.id} ${incident.title}`),
  ].join("\n");

  await sendTelegramAlert(site.telegramChatId, message);
}

async function notifyResolvedWaitingVerification(siteId: number, incidentId: number, title: string) {
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  if (!site?.telegramChatId) return;
  await sendTelegramAlert(site.telegramChatId, `*Incident Resolved*\nSite: ${site.name}\n#${incidentId} ${title}\nWaiting for admin verification.`);
}

export async function assignIncident(prevState: unknown, formData: FormData) {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const incidentId = Number(formData.get("incidentId"));
  const assignedToId = Number(formData.get("assignedToId")) || null;
  const severity = formData.get("severity") as IncidentSeverity;
  const dueDateRaw = formData.get("dueDate") as string;
  const dueDate = dueDateRaw ? new Date(dueDateRaw) : null;

  const existing = await db.query.incidents.findFirst({
    where: and(eq(incidents.id, incidentId), eq(incidents.siteId, auth.activeSiteId)),
  });
  if (!existing) return { message: "Incident not found." };

  await db.update(incidents).set({
    assignedToId,
    severity,
    dueDate,
    updatedAt: new Date(),
  }).where(eq(incidents.id, incidentId));

  await db.insert(incidentUpdates).values({
    incidentId,
    authorId: auth.session.userId,
    updateType: "assigned",
    note: `Assigned to user #${assignedToId ?? "none"} with ${severity} severity.`,
  });

  if (existing.severity !== "Critical" && severity === "Critical") {
    const updated = await db.query.incidents.findFirst({ where: eq(incidents.id, incidentId) });
    if (updated) await notifyCriticalIncidents(auth.activeSiteId, [updated]);
  }

  await logAudit({ action: "UPDATE", entity: "incident", entityId: incidentId, entityName: existing.title });
  revalidatePath("/admin/incidents");
  revalidatePath(`/admin/incidents/${incidentId}`);
  return { success: true };
}

export async function addIncidentUpdate(prevState: unknown, formData: FormData) {
  const auth = await requireActiveSiteAction();
  if (!auth.ok) return { message: auth.message };

  const incidentId = Number(formData.get("incidentId"));
  const note = (formData.get("note") as string)?.trim();
  const photoFile = formData.get("photo") as File;

  const existing = await db.query.incidents.findFirst({
    where: and(eq(incidents.id, incidentId), eq(incidents.siteId, auth.activeSiteId)),
  });
  if (!existing) return { message: "Incident not found." };

  const canAdminister = await hasAdminAccess();
  if (!canAdminister && existing.assignedToId !== auth.session.userId) return { message: "Unauthorized." };
  if (!note && (!photoFile || photoFile.size === 0)) return { message: "Add a note or evidence photo." };

  const photoPath = await saveUploadFile(photoFile, `incident-${incidentId}-${auth.session.userId}`);
  await db.insert(incidentUpdates).values({
    incidentId,
    authorId: auth.session.userId,
    updateType: photoPath ? "evidence" : "comment",
    note,
    photoPath,
  });

  revalidatePath(`/admin/incidents/${incidentId}`);
  return { success: true };
}

export async function changeIncidentStatus(prevState: unknown, formData: FormData) {
  const auth = await requireActiveSiteAction();
  if (!auth.ok) return { message: auth.message };

  const incidentId = Number(formData.get("incidentId"));
  const next = formData.get("status") as IncidentStatus;
  const resolutionCategory = formData.get("resolutionCategory") as ResolutionCategory | null;
  const resolutionAction = formData.get("resolutionAction") as ResolutionAction | null;
  const note = (formData.get("note") as string)?.trim();

  const existing = await db.query.incidents.findFirst({
    where: and(eq(incidents.id, incidentId), eq(incidents.siteId, auth.activeSiteId)),
  });
  if (!existing) return { message: "Incident not found." };

  const canAdminister = await hasAdminAccess();
  const allowed = canTransitionIncidentStatus({
    isAdmin: canAdminister,
    isAssignee: existing.assignedToId === auth.session.userId,
    current: existing.status,
    next,
  });
  if (!allowed) return { message: "Status transition is not allowed." };
  if (next === "Resolved" && (!resolutionCategory || !resolutionAction)) {
    return { message: "Resolution category and action are required before resolving." };
  }

  await db.update(incidents).set({
    status: next,
    resolutionCategory: next === "Resolved" ? resolutionCategory : existing.resolutionCategory,
    resolutionAction: next === "Resolved" ? resolutionAction : existing.resolutionAction,
    resolvedById: next === "Resolved" ? auth.session.userId : existing.resolvedById,
    resolvedAt: next === "Resolved" ? new Date() : existing.resolvedAt,
    verifiedById: next === "Verified" ? auth.session.userId : existing.verifiedById,
    verifiedAt: next === "Verified" ? new Date() : existing.verifiedAt,
    updatedAt: new Date(),
  }).where(eq(incidents.id, incidentId));

  await db.insert(incidentUpdates).values({
    incidentId,
    authorId: auth.session.userId,
    updateType: "status_changed",
    note,
    previousStatus: existing.status,
    newStatus: next,
  });

  if (next === "Resolved") {
    await notifyResolvedWaitingVerification(auth.activeSiteId, incidentId, existing.title);
  }

  await logAudit({ action: "UPDATE", entity: "incident", entityId: incidentId, entityName: existing.title });
  revalidatePath("/admin/incidents");
  revalidatePath(`/admin/incidents/${incidentId}`);
  return { success: true };
}
```

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit`

Expected: PASS.

Commit:

```bash
git add actions/incidents.ts
git commit -m "feat: add incident server actions"
```

---

### Task 5: Auto-Create Incidents From Checklist

**Files:**
- Modify: `actions/checklist.ts`

- [ ] **Step 1: Import service**

```ts
import { createIncidentsForChecklistItems } from "@/actions/incidents";
```

- [ ] **Step 2: Capture inserted checklist item IDs**

Replace the existing single insert inside `submitChecklist` with:

```ts
const [item] = await db.insert(checklistItems).values({
    entryId: entry.id,
    deviceId,
    status: status || "OK",
    remarks: remarks || "",
    photoPath,
}).returning();

if (status === "Warning" || status === "Error") {
    alertItems.push({ deviceId, status, remarks: remarks || "No remarks provided" });
    incidentItems.push({
        checklistItemId: item.id,
        deviceId,
        status,
        remarks: remarks || "No remarks provided",
    });
}
```

Declare `incidentItems` beside `alertItems`:

```ts
const incidentItems: {
    checklistItemId: number;
    deviceId: number;
    status: "Warning" | "Error";
    remarks: string;
}[] = [];
```

- [ ] **Step 3: Call incident creation before revalidation**

Add after the Telegram block:

```ts
await createIncidentsForChecklistItems({
    siteId: auth.activeSiteId,
    userId: session.userId,
    items: incidentItems,
});
```

Add revalidation:

```ts
revalidatePath("/admin/incidents");
revalidatePath("/checklist");
revalidatePath("/report");
```

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit`

Expected: PASS.

Run: `npm run test -- lib/incidents.test.ts`

Expected: PASS.

Commit:

```bash
git add actions/checklist.ts
git commit -m "feat: create incidents from checklist failures"
```

---

### Task 6: Incident List UI

**Files:**
- Create: `components/admin/incident-table.tsx`
- Create: `app/(dashboard)/admin/incidents/page.tsx`
- Modify: `components/ui/navbar.tsx`
- Modify: `app/(dashboard)/admin/page.tsx`

- [ ] **Step 1: Create incident table component**

```tsx
// components/admin/incident-table.tsx
import Link from "next/link";

type IncidentRow = {
  id: number;
  title: string;
  severity: string;
  status: string;
  dueDate: Date | null;
  deviceName: string;
  assignee: string | null;
  isRecurring: boolean;
};

const severityClass: Record<string, string> = {
  Low: "bg-slate-500/15 text-slate-300",
  Medium: "bg-yellow-500/15 text-yellow-300",
  High: "bg-orange-500/15 text-orange-300",
  Critical: "bg-red-500/15 text-red-300",
};

export default function IncidentTable({ incidents }: { incidents: IncidentRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700/50">
      <table className="w-full text-left text-sm whitespace-nowrap">
        <thead className="bg-[#0d1526] text-slate-500 text-xs uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Incident</th>
            <th className="px-4 py-3">Device</th>
            <th className="px-4 py-3">Severity</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Assignee</th>
            <th className="px-4 py-3">Due</th>
            <th className="px-4 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/50">
          {incidents.length === 0 ? (
            <tr><td colSpan={7} className="p-6 text-center text-slate-500">No incidents found.</td></tr>
          ) : incidents.map((incident) => (
            <tr key={incident.id} className="hover:bg-slate-800/30">
              <td className="px-4 py-3">
                <div className="font-medium text-white">#{incident.id} {incident.title}</div>
                {incident.isRecurring && <div className="text-xs text-red-300 mt-1">Recurring issue</div>}
              </td>
              <td className="px-4 py-3 text-slate-300">{incident.deviceName}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${severityClass[incident.severity] ?? severityClass.Medium}`}>
                  {incident.severity}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-300">{incident.status}</td>
              <td className="px-4 py-3 text-slate-400">{incident.assignee ?? "-"}</td>
              <td className="px-4 py-3 text-slate-400">{incident.dueDate ? incident.dueDate.toLocaleString("en-GB") : "-"}</td>
              <td className="px-4 py-3 text-right">
                <Link className="text-blue-400 hover:text-blue-300" href={`/admin/incidents/${incident.id}`}>Open</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Create list page**

```tsx
// app/(dashboard)/admin/incidents/page.tsx
import { getIncidentStats, getIncidents, type IncidentListFilters } from "@/actions/incidents";
import IncidentTable from "@/components/admin/incident-table";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function IncidentListPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await verifySession();
  if (!session) redirect("/login");
  if (!session.activeSiteId) redirect("/select-site");

  const params = await searchParams;
  const filters: IncidentListFilters = {
    status: params.status as IncidentListFilters["status"],
    severity: params.severity as IncidentListFilters["severity"],
    due: params.due as IncidentListFilters["due"],
  };

  const [stats, rows] = await Promise.all([getIncidentStats(), getIncidents(filters)]);

  return (
    <main className="max-w-[1600px] mx-auto px-5 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white font-display">Incident Center</h1>
        <p className="text-sm text-slate-400">Track checklist issues through assignment, remediation, and verification.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glow-card p-4"><p className="text-xs text-slate-400">Open</p><p className="text-3xl font-bold text-white">{stats.open}</p></div>
        <div className="glow-card p-4"><p className="text-xs text-slate-400">Critical</p><p className="text-3xl font-bold text-red-300">{stats.critical}</p></div>
        <div className="glow-card p-4"><p className="text-xs text-slate-400">Due Today</p><p className="text-3xl font-bold text-yellow-300">{stats.dueToday}</p></div>
        <div className="glow-card p-4"><p className="text-xs text-slate-400">Overdue</p><p className="text-3xl font-bold text-orange-300">{stats.overdue}</p></div>
      </div>
      <IncidentTable incidents={rows} />
    </main>
  );
}
```

- [ ] **Step 3: Add navigation**

In `components/ui/navbar.tsx`, add a top-level link near Reports:

```tsx
<Link href="/admin/incidents" className={navLinkClass("/admin/incidents")}>Incidents</Link>
```

In `app/(dashboard)/admin/page.tsx`, add a quick access card:

```tsx
<Link href="/admin/incidents" className="glow-card p-4 hover:border-red-500/30">
    <div className="flex items-center gap-3">
        <div className="size-10 rounded-lg bg-red-500/15 flex items-center justify-center text-red-400">
            <span className="material-symbols-outlined">report_problem</span>
        </div>
        <div>
            <h3 className="font-semibold text-white text-sm">Incidents</h3>
            <p className="text-xs text-slate-500">Remediation</p>
        </div>
    </div>
</Link>
```

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit`

Expected: PASS.

Commit:

```bash
git add components/admin/incident-table.tsx app/\(dashboard\)/admin/incidents/page.tsx components/ui/navbar.tsx app/\(dashboard\)/admin/page.tsx
git commit -m "feat: add incident list page"
```

---

### Task 7: Incident Detail and Update UI

**Files:**
- Create: `components/admin/incident-assignment-form.tsx`
- Create: `components/admin/incident-status-form.tsx`
- Create: `components/admin/incident-update-form.tsx`
- Create: `components/admin/incident-detail.tsx`
- Create: `app/(dashboard)/admin/incidents/[id]/page.tsx`

- [ ] **Step 1: Create assignment form**

```tsx
// components/admin/incident-assignment-form.tsx
"use client";

import { assignIncident } from "@/actions/incidents";
import { useActionState } from "react";

type UserOption = { id: number; username: string };

export default function IncidentAssignmentForm({
  incidentId,
  users,
  currentAssigneeId,
  currentSeverity,
  currentDueDate,
}: {
  incidentId: number;
  users: UserOption[];
  currentAssigneeId: number | null;
  currentSeverity: string;
  currentDueDate: Date | null;
}) {
  const [state, formAction, pending] = useActionState(assignIncident, null);

  return (
    <form action={formAction} className="glow-card p-5 space-y-4">
      <input type="hidden" name="incidentId" value={incidentId} />
      <h2 className="text-lg font-bold text-white">Assignment</h2>
      <select name="assignedToId" defaultValue={currentAssigneeId ?? ""} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white">
        <option value="">Unassigned</option>
        {users.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}
      </select>
      <select name="severity" defaultValue={currentSeverity} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white">
        {["Low", "Medium", "High", "Critical"].map((severity) => <option key={severity} value={severity}>{severity}</option>)}
      </select>
      <input name="dueDate" type="datetime-local" defaultValue={currentDueDate ? currentDueDate.toISOString().slice(0, 16) : ""} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white" />
      {state?.message && <p className="text-sm text-red-300">{state.message}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save Assignment</button>
    </form>
  );
}
```

- [ ] **Step 2: Create status form**

```tsx
// components/admin/incident-status-form.tsx
"use client";

import { changeIncidentStatus } from "@/actions/incidents";
import { useActionState } from "react";

export default function IncidentStatusForm({ incidentId, currentStatus }: { incidentId: number; currentStatus: string }) {
  const [state, formAction, pending] = useActionState(changeIncidentStatus, null);

  return (
    <form action={formAction} className="glow-card p-5 space-y-4">
      <input type="hidden" name="incidentId" value={incidentId} />
      <h2 className="text-lg font-bold text-white">Status</h2>
      <select name="status" defaultValue={currentStatus} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white">
        {["Open", "In Progress", "Resolved", "Verified"].map((status) => <option key={status} value={status}>{status}</option>)}
      </select>
      <select name="resolutionCategory" className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white">
        <option value="">Resolution category</option>
        {["Hardware", "Power", "Network", "Environment", "Human Error", "False Alarm", "Other"].map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      <select name="resolutionAction" className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white">
        <option value="">Resolution action</option>
        {["Replaced", "Reconfigured", "Restarted", "Cleaned", "Escalated", "No Action Needed"].map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      <textarea name="note" rows={3} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white" placeholder="Status note" />
      {state?.message && <p className="text-sm text-red-300">{state.message}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Update Status</button>
    </form>
  );
}
```

- [ ] **Step 3: Create update form**

```tsx
// components/admin/incident-update-form.tsx
"use client";

import { addIncidentUpdate } from "@/actions/incidents";
import { useActionState } from "react";

export default function IncidentUpdateForm({ incidentId }: { incidentId: number }) {
  const [state, formAction, pending] = useActionState(addIncidentUpdate, null);

  return (
    <form action={formAction} className="glow-card p-5 space-y-4">
      <input type="hidden" name="incidentId" value={incidentId} />
      <h2 className="text-lg font-bold text-white">Add Update</h2>
      <textarea name="note" rows={4} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white" placeholder="Progress note" />
      <input name="photo" type="file" accept="image/*" className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-white" />
      {state?.message && <p className="text-sm text-red-300">{state.message}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Add Update</button>
    </form>
  );
}
```

- [ ] **Step 4: Create detail component and page**

```tsx
// components/admin/incident-detail.tsx
import type { getIncidentDetail } from "@/actions/incidents";
import IncidentAssignmentForm from "./incident-assignment-form";
import IncidentStatusForm from "./incident-status-form";
import IncidentUpdateForm from "./incident-update-form";

type IncidentDetailModel = NonNullable<Awaited<ReturnType<typeof getIncidentDetail>>>;

export default function IncidentDetail({
  incident,
  users,
  canAdmin,
}: {
  incident: IncidentDetailModel;
  users: { id: number; username: string }[];
  canAdmin: boolean;
}) {
  return (
    <main className="max-w-[1600px] mx-auto px-5 py-6 grid grid-cols-1 xl:grid-cols-3 gap-6">
      <section className="xl:col-span-2 space-y-6">
        <div className="glow-card p-6">
          <p className="text-sm text-slate-400">Incident #{incident.id}</p>
          <h1 className="text-2xl font-bold text-white">{incident.title}</h1>
          <p className="text-slate-400 mt-2">{incident.description || "No description."}</p>
          {incident.isRecurring && <p className="mt-3 text-sm text-red-300">Recurring issue in the last 30 days.</p>}
        </div>
        <div className="glow-card p-6">
          <h2 className="text-lg font-bold text-white mb-4">Timeline</h2>
          <div className="space-y-4">
            {incident.updates.map((update) => (
              <div key={update.id} className="border-l border-slate-700 pl-4">
                <p className="text-sm text-white">{update.note || update.updateType}</p>
                <p className="text-xs text-slate-500">{update.author?.username || "System"} - {update.createdAt?.toLocaleString("en-GB")}</p>
                {update.photoPath && <a href={update.photoPath} target="_blank" className="text-sm text-blue-400">View evidence</a>}
              </div>
            ))}
          </div>
        </div>
      </section>
      <aside className="space-y-6">
        {canAdmin && <IncidentAssignmentForm incidentId={incident.id} users={users} currentAssigneeId={incident.assignedToId} currentSeverity={incident.severity} currentDueDate={incident.dueDate} />}
        <IncidentStatusForm incidentId={incident.id} currentStatus={incident.status} />
        <IncidentUpdateForm incidentId={incident.id} />
      </aside>
    </main>
  );
}
```

```tsx
// app/(dashboard)/admin/incidents/[id]/page.tsx
import { getAssignableIncidentUsers, getIncidentDetail } from "@/actions/incidents";
import IncidentDetail from "@/components/admin/incident-detail";
import { verifySession } from "@/lib/session";
import { hasAdminAccess } from "@/lib/site-access";
import { notFound, redirect } from "next/navigation";

export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession();
  if (!session) redirect("/login");
  if (!session.activeSiteId) redirect("/select-site");

  const { id } = await params;
  const incident = await getIncidentDetail(Number(id));
  if (!incident) notFound();

  const canAdmin = await hasAdminAccess();
  const users = canAdmin ? await getAssignableIncidentUsers() : [];

  return <IncidentDetail incident={incident} users={users} canAdmin={canAdmin} />;
}
```

- [ ] **Step 5: Verify and commit**

Run: `npm run lint`

Expected: exits 0. Existing warnings may remain; no new errors.

Run: `npx tsc --noEmit`

Expected: PASS.

Commit:

```bash
git add components/admin/incident-assignment-form.tsx components/admin/incident-status-form.tsx components/admin/incident-update-form.tsx components/admin/incident-detail.tsx app/\(dashboard\)/admin/incidents/\[id\]/page.tsx
git commit -m "feat: add incident detail workflow"
```

---

### Task 8: Dashboard and Report Integration

**Files:**
- Modify: `actions/dashboard.ts`
- Modify: `app/(dashboard)/checklist/page.tsx`
- Modify: `actions/report.ts`
- Modify: `components/report/report-filters.tsx`
- Modify: `components/report/export-button.tsx`

- [ ] **Step 1: Add dashboard incident stats**

In `actions/dashboard.ts`, import `incidents` and add:

```ts
const incidentStats = await db.select({
    open: sql<number>`sum(case when ${incidents.status} != 'Verified' then 1 else 0 end)`,
    critical: sql<number>`sum(case when ${incidents.severity} = 'Critical' and ${incidents.status} != 'Verified' then 1 else 0 end)`,
    overdue: sql<number>`sum(case when ${incidents.dueDate} < now() and ${incidents.status} != 'Verified' then 1 else 0 end)`,
})
    .from(incidents)
    .where(siteId ? eq(incidents.siteId, siteId) : undefined)
    .then((res) => ({
        open: Number(res[0]?.open ?? 0),
        critical: Number(res[0]?.critical ?? 0),
        overdue: Number(res[0]?.overdue ?? 0),
    }));
```

Return `incidentStats` from `getDashboardStats()`.

- [ ] **Step 2: Show dashboard cards**

In `app/(dashboard)/checklist/page.tsx`, add an Incident Center quick card in the quick actions grid:

```tsx
<div className="glow-card p-5">
    <div className="flex justify-between items-start mb-3">
        <p className="text-slate-400 text-xs font-medium">Open Incidents</p>
        <div className="size-8 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400">
            <span className="material-symbols-outlined text-[18px]">report_problem</span>
        </div>
    </div>
    <p className="text-3xl font-bold text-white">{stats.incidentStats.open}</p>
    <p className="text-xs text-slate-500 mt-1">{stats.incidentStats.critical} critical, {stats.incidentStats.overdue} overdue</p>
    <Link href="/admin/incidents" className="mt-3 inline-block text-sm text-blue-400 hover:text-blue-300">Open Incident Center</Link>
</div>
```

- [ ] **Step 3: Join incident state into reports**

In `actions/report.ts`, import `incidents`, add optional `incidentStatus` to `getReportData()` and `getRawExportData()`, left join incidents by checklist item, and select:

```ts
incidentId: incidents.id,
incidentStatus: incidents.status,
incidentSeverity: incidents.severity,
```

Extend the where clause:

```ts
incidentStatus ? eq(incidents.status, incidentStatus) : undefined
```

Add export fields:

```ts
Incident: item.incidentId ? `#${item.incidentId}` : "-",
IncidentStatus: item.incidentStatus ?? "-",
IncidentSeverity: item.incidentSeverity ?? "-",
```

- [ ] **Step 4: Add report filter UI**

In `components/report/report-filters.tsx`, read and preserve `incidentStatus`:

```tsx
const currentIncidentStatus = searchParams.get("incidentStatus") || "";
const [incidentStatus, setIncidentStatus] = useState(currentIncidentStatus);

const handleApply = () => {
    const params = new URLSearchParams();
    params.set("startDate", startDate);
    params.set("endDate", endDate);
    if (incidentStatus) params.set("incidentStatus", incidentStatus);
    router.push(`/report?${params.toString()}`);
};
```

Add the select:

```tsx
<select value={incidentStatus} onChange={(event) => setIncidentStatus(event.target.value)} className="text-sm font-medium bg-transparent text-slate-700 dark:text-slate-200 focus:outline-none">
    <option value="">All incidents</option>
    {["Open", "In Progress", "Resolved", "Verified"].map((status) => <option key={status} value={status}>{status}</option>)}
</select>
```

- [ ] **Step 5: Pass incident status into exports**

In `components/report/export-button.tsx`, read:

```ts
const incidentStatus = searchParams.get("incidentStatus") || "";
```

Call:

```ts
const base64 = await exportToExcel(startDate, endDate, incidentStatus || undefined);
const data = await getRawExportData(startDate, endDate, incidentStatus || undefined);
```

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit`

Expected: PASS.

Commit:

```bash
git add actions/dashboard.ts app/\(dashboard\)/checklist/page.tsx actions/report.ts components/report/report-filters.tsx components/report/export-button.tsx
git commit -m "feat: integrate incidents into dashboard and reports"
```

---

### Task 9: Overdue Telegram Notification Script

**Files:**
- Create: `scripts/notify-overdue-incidents.ts`
- Modify: `package.json`

- [ ] **Step 1: Create notification script**

```ts
// scripts/notify-overdue-incidents.ts
import "dotenv/config";

import { db } from "@/db";
import { incidents, sites } from "@/db/schema";
import { sendTelegramAlert } from "@/lib/telegram";
import { and, eq, isNull, lt, ne, or } from "drizzle-orm";

async function main() {
  const overdue = await db.select({
    id: incidents.id,
    title: incidents.title,
    siteId: incidents.siteId,
    siteName: sites.name,
    chatId: sites.telegramChatId,
  })
    .from(incidents)
    .innerJoin(sites, eq(incidents.siteId, sites.id))
    .where(and(
      lt(incidents.dueDate, new Date()),
      ne(incidents.status, "Verified"),
      or(isNull(incidents.lastOverdueNotifiedAt), lt(incidents.lastOverdueNotifiedAt, incidents.dueDate)),
    ));

  for (const incident of overdue) {
    if (!incident.chatId) continue;

    await sendTelegramAlert(
      incident.chatId,
      `*Incident Overdue*\nSite: ${incident.siteName}\n#${incident.id} ${incident.title}`,
    );

    await db.update(incidents).set({ lastOverdueNotifiedAt: new Date() }).where(eq(incidents.id, incident.id));
  }

  console.log(`Overdue incident notifications sent: ${overdue.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

Add to `package.json` scripts:

```json
"incidents:notify-overdue": "tsx scripts/notify-overdue-incidents.ts"
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit`

Expected: PASS.

Run manually only on a development database with Telegram env configured:

`npm run incidents:notify-overdue`

Expected: prints `Overdue incident notifications sent: N`.

Commit:

```bash
git add scripts/notify-overdue-incidents.ts package.json package-lock.json
git commit -m "feat: add overdue incident notifications"
```

---

### Task 10: Final Verification

**Files:**
- Review all changed files.

- [ ] **Step 1: Run focused tests**

Run: `npm run test -- lib/incidents.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full check**

Run: `npm run check`

Expected: lint exits 0, tests pass, production build succeeds. Existing lint warnings are acceptable only if they were present before this feature.

- [ ] **Step 3: Review migration safety**

Run: `git status --short`

Expected: only intended incident files, migration files, and package files changed.

Do not run `npm run db:migrate` against production data from this plan. Apply the generated migration first to a blank or backed-up staging PostgreSQL database.

- [ ] **Step 4: Manual browser smoke test**

Run: `npm run dev`

Open `http://localhost:3000`, then verify:

- Submitting a checklist with `Warning` creates one `Open` incident.
- Submitting a checklist with `Error` creates one `Open` incident with `High` severity.
- `/admin/incidents` shows the incident scoped to the active site.
- Incident detail allows assignment, status change, comment, and evidence upload.
- Staff users see only created or assigned incidents.
- Report page can filter by incident status and export includes incident columns.
- Dashboard shows incident KPI counts.

- [ ] **Step 5: Final commit if uncommitted fixes exist**

```bash
git add .
git commit -m "chore: finalize incident center"
```

Skip this commit if every previous task already committed all intended files.

---

## Self-Review

- Spec coverage: auto-create from checklist is Task 5; list/detail pages are Tasks 6 and 7; assignment, severity, due date, status workflow, comments, and evidence are Tasks 4 and 7; dashboard/report are Task 8; Telegram critical/resolved/overdue notifications are Tasks 4 and 9; active-site permissions are Task 4.
- Placeholder scan: no open placeholders are intentionally left in this plan.
- Type consistency: status, severity, resolution category, and resolution action strings match the planned Drizzle enums and `lib/incidents.ts` types.
