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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
