"use server";

import { db } from "@/db";
import { devices, incidentUpdates, incidents, sites, siteTelegramChatIds, userSites, users } from "@/db/schema";
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
import { resolveNotificationBaseUrl } from "@/lib/notification-url";
import { escapeTelegramHtml, sendTelegramAlert } from "@/lib/telegram";
import { saveUploadFile, UploadValidationError } from "@/lib/upload";
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

async function resolveIncidentRecipients(siteId: number, severity: IncidentSeverity, legacyChatId: string | null | undefined) {
  const rows = await db
    .select({
      chatId: siteTelegramChatIds.chatId,
      severityFilter: siteTelegramChatIds.severityFilter,
      enabled: siteTelegramChatIds.enabled,
    })
    .from(siteTelegramChatIds)
    .where(eq(siteTelegramChatIds.siteId, siteId));

  if (rows.length === 0) {
    const legacy = legacyChatId?.trim();
    return legacy ? [{ chatId: legacy }] : [];
  }

  return rows
    .filter((row) => row.enabled)
    .filter((row) => {
      if (!row.severityFilter) return true;
      const allowed = row.severityFilter.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      return allowed.includes(severity);
    })
    .map((row) => ({ chatId: row.chatId }));
}

// Fire-and-forget so a Telegram outage can never fail the action after
// the incident row is committed (a thrown error here made callers report
// failure and get resubmitted → duplicate incidents/checklist entries).
// Each send result is audited (finding #59) with chatId + success/failure;
// logAudit never throws and the send still never blocks the caller.
function sendIncidentAlertFireAndForget(chatId: string, message: string, audit: Parameters<typeof logAudit>[0]) {
  sendTelegramAlert(chatId, message)
    .then((result) => {
      void logAudit({
        ...audit,
        detail: `chatId=${chatId} success=${result.success}${result.message ? `: ${result.message}` : ""} ${audit.detail ?? ""}`.trim(),
      });
      if (!result.success) {
        console.error(`Telegram alert send failed for chatId=${chatId}:`, result.message);
      }
    })
    .catch((error) => {
      console.error("Failed to send telegram alert:", error);
      void logAudit({
        ...audit,
        detail: `chatId=${chatId} error=${String(error)} ${audit.detail ?? ""}`.trim(),
      });
    });
}

async function notifyCriticalIncidents(siteId: number, criticalIncidents: IncidentRecord[]) {
  if (criticalIncidents.length === 0) return;

  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  if (!site) return;

  const recipients = await resolveIncidentRecipients(siteId, "Critical", site.telegramChatId);
  if (recipients.length === 0) return;

  const baseUrl = await resolveNotificationBaseUrl();
  // parse_mode=HTML (#58): bold via <b>, incident links as anchors, and
  // entity-supplied site/incident fields HTML-escaped (previously raw
  // Markdown interpolation was an injection vector, #75).
  const message = [
    "<b>Critical Incident Opened</b>",
    `Site: ${escapeTelegramHtml(site.name)}`,
    ...criticalIncidents.map(
      (incident) =>
        `<a href="${escapeTelegramHtml(`${baseUrl}/admin/incidents/${incident.id}`)}">#${incident.id} ${escapeTelegramHtml(incident.title)}</a>`,
    ),
  ].join("\n");

  for (const recipient of recipients) {
    sendIncidentAlertFireAndForget(recipient.chatId, message, {
      action: "TELEGRAM_SEND",
      entity: "incident",
      entityId: criticalIncidents[0].id,
      entityName: criticalIncidents.map((incident) => `#${incident.id}`).join(", "),
      detail: `critical incident alert (${criticalIncidents.length} incident(s))`,
    });
  }
}

async function notifyResolvedWaitingVerification(siteId: number, incidentId: number, title: string) {
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  if (!site) return;

  // Resolved is treated as Low-severity for filter purposes.
  const recipients = await resolveIncidentRecipients(siteId, "Low", site.telegramChatId);
  if (recipients.length === 0) return;

  const baseUrl = await resolveNotificationBaseUrl();
  const message = `<b>Incident Resolved</b>\nSite: ${escapeTelegramHtml(site.name)}\n<a href="${escapeTelegramHtml(`${baseUrl}/admin/incidents/${incidentId}`)}">#${incidentId} ${escapeTelegramHtml(title)}</a>\nWaiting for admin verification.`;
  // Fire-and-forget so a Telegram outage can never fail the action after
  // the incident row is committed (a thrown error here made callers report
  // failure and get resubmitted → duplicate incidents/checklist entries).
  for (const recipient of recipients) {
    sendIncidentAlertFireAndForget(recipient.chatId, message, {
      action: "TELEGRAM_SEND",
      entity: "incident",
      entityId: incidentId,
      entityName: `#${incidentId} ${title}`,
      detail: "resolved-waiting-verification alert",
    });
  }
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

  // Site members (admin/staff via userSites) plus global superadmins, who have no
  // per-site row. Distinct-merge the two sets in JS to avoid duplicate rows.
  const [siteMembers, superadmins] = await Promise.all([
    db.select({ id: users.id, username: users.username })
      .from(users)
      .innerJoin(userSites, eq(userSites.userId, users.id))
      .where(and(eq(userSites.siteId, auth.activeSiteId), eq(users.isActive, true))),
    db.select({ id: users.id, username: users.username })
      .from(users)
      .where(and(eq(users.role, "superadmin"), eq(users.isActive, true))),
  ]);

  const byId = new Map<number, { id: number; username: string }>();
  for (const u of [...siteMembers, ...superadmins]) byId.set(u.id, u);
  return [...byId.values()].sort((a, b) => a.username.localeCompare(b.username));
}

export async function createIncidentsForChecklistItems(
  input: {
    siteId: number;
    userId: number;
    items: Array<{
      checklistItemId: number;
      deviceId: number;
      status: ChecklistStatus;
      remarks: string;
      photoPath?: string | null;
    }>;
  },
  // Finding #08: submitChecklist creates incidents inside the SAME db.transaction
  // as the entry + items; a mid-loop failure then rolls back the incidents too
  // instead of leaving a partial submit. Defaults to db for other callers.
  executor: Pick<typeof db, "insert" | "query"> = db,
) {
  const incidentItems = input.items
    .map((item) => ({ ...item, severity: getDefaultIncidentSeverity(item.status) }))
    .filter((item): item is typeof item & { severity: IncidentSeverity } => item.severity !== null);

  if (incidentItems.length === 0) return [];

  const deviceRows = await executor.query.devices.findMany({
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

    const [incident] = await executor.insert(incidents).values({
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

    await executor.insert(incidentUpdates).values({
      incidentId: incident.id,
      authorId: input.userId,
      updateType: item.photoPath ? "evidence" : "created",
      note: `Created from checklist item #${item.checklistItemId}`,
      photoPath: item.photoPath ?? null,
      newStatus: "Open",
    });

    created.push(incident);
  }

  // Inside a caller transaction this fires before commit; a rollback after it
  // can leave a stale alert. Acceptable: sends are the final step of
  // submitChecklist, and the alert must not block the DB commit itself.
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
    // Assignee must be an active site member OR a global superadmin (who has no
    // per-site row).
    const assignee = await db.select({ id: users.id, role: users.role, siteId: userSites.siteId })
      .from(users)
      .leftJoin(userSites, and(eq(userSites.userId, users.id), eq(userSites.siteId, auth.activeSiteId)))
      .where(and(eq(users.id, assignedToId), eq(users.isActive, true)))
      .limit(1);
    if (!assignee[0]) return { message: "Assignee is not an active user." };
    if (assignee[0].role !== "superadmin" && assignee[0].siteId === null) {
      return { message: "Assignee is not active in this site." };
    }
  }

  // Finding #61 (optimistic concurrency): the update matches only if the
  // incident still has the status we read; a concurrent change makes the
  // WHERE select no rows and this edit is rejected without an incidentUpdates
  // row (no stale-base append).
  const optimistic = await db.update(incidents).set({
    assignedToId,
    severity,
    dueDate,
    updatedAt: new Date(),
  }).where(and(
    eq(incidents.id, incidentId),
    eq(incidents.siteId, auth.activeSiteId),
    eq(incidents.status, existing.status),
  )).returning({ id: incidents.id });

  if (optimistic.length === 0) {
    return { message: "Incident was updated by someone else. Reload the page and try again." };
  }

  await db.insert(incidentUpdates).values({
    incidentId,
    authorId: auth.session.userId,
    updateType: "assigned",
    note: `Assigned to user #${assignedToId ?? "none"} with ${severity} severity.`,
  });

  if (existing.severity !== "Critical" && severity === "Critical") {
    const refreshed = await db.query.incidents.findFirst({ where: eq(incidents.id, incidentId) });
    if (refreshed) await notifyCriticalIncidents(auth.activeSiteId, [refreshed]);
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

  let photoPath: string | null = null;
  if (photoFile) {
    try {
      photoPath = await saveUploadFile(photoFile, `incident-${incidentId}-${auth.session.userId}`, {
        kind: "photo",
        directory: "root",
      });
    } catch (error) {
      if (error instanceof UploadValidationError) return { message: error.message };
      console.error("Incident evidence upload error:", error);
      return { message: "Failed to upload evidence photo." };
    }
  }
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
  // Finding #24: Verified (admin fast-path from Open/In Progress) is a
  // resolution state and requires resolution data just like Resolved. Data may
  // be staged fresh in the form -- or already on record from the Resolved step,
  // where the form's pristine selects must not wipe the stored values.
  const resolutionState = next === "Resolved" || next === "Verified";
  const effectiveCategory: ResolutionCategory | null =
    resolutionCategory ?? (next === "Verified" ? existing.resolutionCategory : null);
  const effectiveAction: ResolutionAction | null =
    resolutionAction ?? (next === "Verified" ? existing.resolutionAction : null);
  const effectiveResolutionProvided = Boolean(effectiveCategory && effectiveAction);

  if (resolutionState && !effectiveResolutionProvided) {
    return { message: "Resolution category and action are required before resolving." };
  }

  const allowedTransition = canTransitionIncidentStatus({
    isAdmin: canAdminister,
    isAssignee: existing.assignedToId === auth.session.userId,
    current: existing.status,
    next,
    resolutionProvided: effectiveResolutionProvided,
  });
  if (!allowedTransition) return { message: "Status transition is not allowed." };

  // Finding #61 (optimistic concurrency): same-status-restricted write as
  // assignIncident — a concurrent status change rejects this edit before the
  // status_changed update row or notifications are appended.
  const optimistic = await db.update(incidents).set({
    status: next,
    // Reopening to Open clears stale resolution/verification stamps so a
    // later resolve starts from a clean record (finding #24).
    resolutionCategory: resolutionState ? effectiveCategory : next === "Open" ? null : existing.resolutionCategory,
    resolutionAction: resolutionState ? effectiveAction : next === "Open" ? null : existing.resolutionAction,
    resolvedById: resolutionState ? auth.session.userId : next === "Open" ? null : existing.resolvedById,
    resolvedAt: resolutionState ? new Date() : next === "Open" ? null : existing.resolvedAt,
    verifiedById: next === "Verified" ? auth.session.userId : next === "Open" ? null : existing.verifiedById,
    verifiedAt: next === "Verified" ? new Date() : next === "Open" ? null : existing.verifiedAt,
    updatedAt: new Date(),
  }).where(and(
    eq(incidents.id, incidentId),
    eq(incidents.siteId, auth.activeSiteId),
    eq(incidents.status, existing.status),
  )).returning({ id: incidents.id });

  if (optimistic.length === 0) {
    return { message: "Incident was updated by someone else. Reload the page and try again." };
  }

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
