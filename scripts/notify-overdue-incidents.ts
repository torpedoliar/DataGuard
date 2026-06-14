import "dotenv/config";

import { db } from "@/db";
import { incidents, sites } from "@/db/schema";
import { logAuditManual } from "@/lib/audit";
import { sendTelegramAlert } from "@/lib/telegram";
import { and, eq, isNull, lt, ne, or } from "drizzle-orm";

export interface NotifyOverdueResult {
  notified: number;
  scanned: number;
}

export async function notifyOverdueIncidents(): Promise<NotifyOverdueResult> {
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

  let sent = 0;
  for (const incident of overdue) {
    if (!incident.chatId) continue;

    const result = await sendTelegramAlert(
      incident.chatId,
      `*Incident Overdue*\nSite: ${incident.siteName}\n#${incident.id} ${incident.title}`,
    );

    if (!result.success) continue;

    await db.update(incidents)
      .set({ lastOverdueNotifiedAt: new Date() })
      .where(eq(incidents.id, incident.id));
    sent += 1;
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
