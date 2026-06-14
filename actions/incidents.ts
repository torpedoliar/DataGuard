"use server";

import { db } from "@/db";
import { devices, incidentUpdates, incidents, sites, userSites, users } from "@/db/schema";
import { requireActiveSiteAction, requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import {
  calculateIncidentDueDate,
  canTransitionIncidentStatus,
  getDefaultIncidentSeverity,
  incidentSeverities,
  incidentStatuses,
  isRecurringIncident,
  resolutionActions,
  resolutionCategories,
  type ChecklistStatus,
  type IncidentSeverity,
  type IncidentStatus,
  type ResolutionAction,
  type ResolutionCategory,
} from "@/lib/incidents";
import { hasAdminAccess } from "@/lib/site-access";
import { sendTelegramAlert } from "@/lib/telegram";
import { saveUploadFile } from "@/lib/upload";
import { and, asc, desc, eq, gte, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";

type IncidentRecord = typeof incidents.$inferSelect;

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

function parseIncidentSeverity(value: FormDataEntryValue | null): IncidentSeverity | null {
  return typeof value === "string" && incidentSeverities.includes(value as IncidentSeverity)
    ? value as IncidentSeverity
    : null;
}

function parseIncidentStatus(value: FormDataEntryValue | null): IncidentStatus | null {
  return typeof value === "string" && incidentStatuses.includes(value as IncidentStatus)
    ? value as IncidentStatus
    : null;
}

function parseResolutionCategory(value: FormDataEntryValue | null): ResolutionCategory | null {
  return typeof value === "string" && resolutionCategories.includes(value as ResolutionCategory)
    ? value as ResolutionCategory
    : null;
}

function parseResolutionAction(value: FormDataEntryValue | null): ResolutionAction | null {
  return typeof value === "string" && resolutionActions.includes(value as ResolutionAction)
    ? value as ResolutionAction
    : null;
}

function revalidateIncidentPaths(incidentId?: number) {
  revalidatePath("/admin/incidents");
  if (incidentId) revalidatePath(`/admin/incidents/${incidentId}`);
  revalidatePath("/checklist");
  revalidatePath("/report");
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

async function notifyCriticalIncidents(siteId: number, criticalIncidents: IncidentRecord[]) {
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

  await sendTelegramAlert(
    site.telegramChatId,
    `*Incident Resolved*\nSite: ${site.name}\n#${incidentId} ${title}\nWaiting for admin verification.`,
  );
}

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
  const conditions: SQL[] = [eq(incidents.siteId, auth.activeSiteId)];

  if (!canAdminister) {
    conditions.push(or(
      eq(incidents.createdById, auth.session.userId),
      eq(incidents.assignedToId, auth.session.userId),
    )!);
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
  return rows.map((row) => ({
    ...row,
    isRecurring: isRecurringIncident(recurringCounts.get(row.deviceId) ?? 0),
  }));
}

export async function getIncidentDetail(incidentId: number) {
  const auth = await requireActiveSiteAction();
  if (!auth.ok) return null;

  const incident = await db.query.incidents.findFirst({
    where: and(eq(incidents.id, incidentId), eq(incidents.siteId, auth.activeSiteId)),
    with: {
      device: true,
      assignedTo: true,
      createdBy: true,
      updates: {
        with: { author: true },
        orderBy: desc(incidentUpdates.createdAt),
      },
    },
  });
  if (!incident) return null;

  const canAdminister = await hasAdminAccess();
  const canView = canAdminister
    || incident.createdById === auth.session.userId
    || incident.assignedToId === auth.session.userId;
  if (!canView) return null;

  const recurringCounts = await getRecurringDeviceCounts(auth.activeSiteId, [incident.deviceId]);
  return {
    ...incident,
    isRecurring: isRecurringIncident(recurringCounts.get(incident.deviceId) ?? 0),
  };
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

export async function createIncidentsForChecklistItems(input: {
  siteId: number;
  userId: number;
  items: Array<{
    checklistItemId: number;
    deviceId: number;
    status: ChecklistStatus;
    remarks: string;
    photoPath?: string | null;
  }>;
}) {
  const incidentItems = input.items
    .map((item) => ({ ...item, severity: getDefaultIncidentSeverity(item.status) }))
    .filter((item): item is typeof item & { severity: IncidentSeverity } => item.severity !== null);

  if (incidentItems.length === 0) return [];

  const deviceRows = await db.query.devices.findMany({
    where: and(
      eq(devices.siteId, input.siteId),
      inArray(devices.id, incidentItems.map((item) => item.deviceId)),
    ),
  });
  const deviceById = new Map(deviceRows.map((device) => [device.id, device]));

  const created: IncidentRecord[] = [];
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
    }).onConflictDoNothing({ target: incidents.checklistItemId }).returning();

    if (!incident) continue;

    await db.insert(incidentUpdates).values({
      incidentId: incident.id,
      authorId: input.userId,
      updateType: item.photoPath ? "evidence" : "created",
      note: `Created from checklist item #${item.checklistItemId}`,
      photoPath: item.photoPath ?? null,
      newStatus: "Open",
    });

    created.push(incident);
  }

  await notifyCriticalIncidents(input.siteId, created.filter((incident) => incident.severity === "Critical"));
  return created;
}

export async function assignIncident(prevState: unknown, formData: FormData) {
  void prevState;

  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const incidentId = Number(formData.get("incidentId"));
  const assignedToId = Number(formData.get("assignedToId")) || null;
  const severity = parseIncidentSeverity(formData.get("severity"));
  const dueDateRaw = formData.get("dueDate");
  const dueDate = typeof dueDateRaw === "string" && dueDateRaw ? new Date(dueDateRaw) : null;

  if (!incidentId) return { message: "Invalid incident." };
  if (!severity) return { message: "Invalid severity." };
  if (dueDate && Number.isNaN(dueDate.getTime())) return { message: "Invalid due date." };

  const existing = await db.query.incidents.findFirst({
    where: and(eq(incidents.id, incidentId), eq(incidents.siteId, auth.activeSiteId)),
  });
  if (!existing) return { message: "Incident not found." };

  if (assignedToId) {
    const assignee = await db.select({ id: users.id })
      .from(users)
      .innerJoin(userSites, eq(userSites.userId, users.id))
      .where(and(
        eq(users.id, assignedToId),
        eq(users.isActive, true),
        eq(userSites.siteId, auth.activeSiteId),
      ))
      .limit(1);
    if (!assignee[0]) return { message: "Assignee is not active in this site." };
  }

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
  revalidateIncidentPaths(incidentId);
  return { success: true };
}

export async function addIncidentUpdate(prevState: unknown, formData: FormData) {
  void prevState;

  const auth = await requireActiveSiteAction();
  if (!auth.ok) return { message: auth.message };

  const incidentId = Number(formData.get("incidentId"));
  const note = (formData.get("note") as string | null)?.trim();
  const photoFile = formData.get("photo") as File | null;

  if (!incidentId) return { message: "Invalid incident." };

  const existing = await db.query.incidents.findFirst({
    where: and(eq(incidents.id, incidentId), eq(incidents.siteId, auth.activeSiteId)),
  });
  if (!existing) return { message: "Incident not found." };

  const canAdminister = await hasAdminAccess();
  const canUpdate = canAdminister
    || existing.assignedToId === auth.session.userId
    || existing.createdById === auth.session.userId;
  if (!canUpdate) return { message: "Unauthorized." };
  if (!note && (!photoFile || photoFile.size === 0)) return { message: "Add a note or evidence photo." };

  const photoPath = photoFile ? await saveUploadFile(photoFile, `incident-${incidentId}-${auth.session.userId}`) : null;
  await db.insert(incidentUpdates).values({
    incidentId,
    authorId: auth.session.userId,
    updateType: photoPath ? "evidence" : "comment",
    note,
    photoPath,
  });

  await logAudit({
    action: "UPDATE",
    entity: "incident",
    entityId: incidentId,
    entityName: existing.title,
    detail: `Update added${photoPath ? " (with evidence photo)" : ""}`,
  });

  revalidateIncidentPaths(incidentId);
  return { success: true };
}

export async function changeIncidentStatus(prevState: unknown, formData: FormData) {
  void prevState;

  const auth = await requireActiveSiteAction();
  if (!auth.ok) return { message: auth.message };

  const incidentId = Number(formData.get("incidentId"));
  const next = parseIncidentStatus(formData.get("status"));
  const resolutionCategory = parseResolutionCategory(formData.get("resolutionCategory"));
  const resolutionAction = parseResolutionAction(formData.get("resolutionAction"));
  const note = (formData.get("note") as string | null)?.trim();

  if (!incidentId) return { message: "Invalid incident." };
  if (!next) return { message: "Invalid status." };

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
  revalidateIncidentPaths(incidentId);
  return { success: true };
}
