import "dotenv/config";

import { db } from "@/db";
import { incidents, siteTelegramChatIds, sites } from "@/db/schema";
import { logAuditManual } from "@/lib/audit";
import { type IncidentSeverity } from "@/lib/incidents";
import { resolveNotificationBaseUrl } from "@/lib/notification-url";
import { escapeTelegramHtml, sendTelegramAlert } from "@/lib/telegram";
import { and, eq, isNull, lt, ne, or } from "drizzle-orm";

export interface NotifyOverdueResult {
  notified: number;
  scanned: number;
}

interface OverdueIncident {
  id: number;
  title: string;
  severity: IncidentSeverity;
  siteId: number;
  siteName: string;
  legacyChatId: string | null;
}

/**
 * Mirrors resolveIncidentRecipients (actions/incidents.ts): prefer the
 * multi-recipient site_telegram_chat_ids table with its severity filters,
 * and fall back to the legacy sites.telegram_chat_id only when a site has
 * no chat rows configured at all.
 */
async function resolveRecipients(
  siteId: number,
  severity: IncidentSeverity,
  legacyChatId: string | null | undefined,
) {
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

export async function notifyOverdueIncidents(): Promise<NotifyOverdueResult> {
  const overdue: OverdueIncident[] = await db.select({
    id: incidents.id,
    title: incidents.title,
    severity: incidents.severity,
    siteId: incidents.siteId,
    siteName: sites.name,
    legacyChatId: sites.telegramChatId,
  })
    .from(incidents)
    .innerJoin(sites, eq(incidents.siteId, sites.id))
    .where(and(
      lt(incidents.dueDate, new Date()),
      ne(incidents.status, "Verified"),
      or(isNull(incidents.lastOverdueNotifiedAt), lt(incidents.lastOverdueNotifiedAt, incidents.dueDate)),
    ));

  const baseUrl = await resolveNotificationBaseUrl();

  let sent = 0;
  for (const incident of overdue) {
    const recipients = await resolveRecipients(incident.siteId, incident.severity, incident.legacyChatId);
    if (recipients.length === 0) continue;

    const message = [
      "<b>Incident Overdue</b>",
      `Site: ${escapeTelegramHtml(incident.siteName)}`,
      `<a href="${escapeTelegramHtml(`${baseUrl}/admin/incidents/${incident.id}`)}">#${incident.id} ${escapeTelegramHtml(incident.title)}</a>`,
    ].join("\n");

    let delivered = 0;
    for (const recipient of recipients) {
      const result = await sendTelegramAlert(recipient.chatId, message);
      if (result.success) delivered += 1;
    }

    // Mark notified only when at least one recipient received it; an
    // all-failed send stays eligible for the next run's retry.
    if (delivered === 0) continue;

    await db.update(incidents)
      .set({ lastOverdueNotifiedAt: new Date() })
      .where(eq(incidents.id, incident.id));
    sent += delivered;
  }

  console.log(`Overdue incident notifications sent: ${sent}`);

  await logAuditManual({
    action: "UPDATE",
    entity: "incident",
    detail: `INCIDENTS_NOTIFY scanned=${overdue.length} notified=${sent}`,
  });

  return { notified: sent, scanned: overdue.length };
}

async function main() {
  await notifyOverdueIncidents();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
