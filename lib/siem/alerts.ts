import { db } from "../../db";
import { siemAlerts, siemFindings, siemSettings } from "../../db/schema";
import { sendTelegramAlert } from "../telegram";
import { and, eq, ne } from "drizzle-orm";
import { redactSensitiveText } from "./redaction";
import type { SiemSeverity } from "./types";

const severityRank: Record<SiemSeverity, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };

function isAtLeastSeverity(value: SiemSeverity, minimum: SiemSeverity) {
  return severityRank[value] >= severityRank[minimum];
}

function alertMessage(input: { findingId: number; title: string; severity: SiemSeverity; siteName: string | null; deviceName: string | null; sourceIp: string | null; summary: string; recommendedAction: string | null }) {
  return redactSensitiveText([
    "*SIEM Finding*",
    `Severity: ${input.severity}`,
    `Site: ${input.siteName ?? "-"}`,
    `Device: ${input.deviceName ?? "Unmapped"}`,
    `Source: ${input.sourceIp ?? "-"}`,
    `Finding: #${input.findingId} ${input.title}`,
    `Summary: ${input.summary}`,
    `Action: ${input.recommendedAction ?? "Review finding in SIEM dashboard."}`,
  ].join("\n"));
}

export async function queueSiemTelegramAlerts() {
  const settings = await db.select().from(siemSettings).limit(1);
  const minSeverity = (settings[0]?.alertMinSeverity ?? "High") as SiemSeverity;

  const rows = await db.query.siemFindings.findMany({
    where: ne(siemFindings.status, "Resolved"),
    with: {
      rule: true,
      site: true,
      device: true,
      source: true,
      alerts: true,
    },
    limit: 100,
  });

  let queued = 0;
  for (const finding of rows) {
    if (!finding.rule?.alertEnabled) continue;
    if (!isAtLeastSeverity(finding.severity as SiemSeverity, minSeverity)) continue;
    if (finding.alerts.some((alert) => alert.channel === "telegram")) continue;
    if (!finding.site?.telegramChatId) continue;

    await db.insert(siemAlerts).values({
      findingId: finding.id,
      channel: "telegram",
      recipient: finding.site.telegramChatId,
      status: "pending",
      message: alertMessage({
        findingId: finding.id,
        title: finding.title,
        severity: finding.severity as SiemSeverity,
        siteName: finding.site.name,
        deviceName: finding.device?.name ?? null,
        sourceIp: finding.source?.sourceIp ?? null,
        summary: finding.humanAnalysis ?? finding.summary,
        recommendedAction: finding.recommendedAction,
      }),
    });
    queued++;
  }

  return { queued };
}

export async function sendPendingSiemTelegramAlerts() {
  const alerts = await db.select({
    id: siemAlerts.id,
    recipient: siemAlerts.recipient,
    message: siemAlerts.message,
  }).from(siemAlerts)
    .where(and(eq(siemAlerts.channel, "telegram"), eq(siemAlerts.status, "pending")))
    .limit(25);

  let sent = 0;
  let failed = 0;
  for (const alert of alerts) {
    const result = await sendTelegramAlert(alert.recipient, alert.message);
    if (result.success) {
      await db.update(siemAlerts).set({ status: "sent", sentAt: new Date(), error: null }).where(eq(siemAlerts.id, alert.id));
      sent++;
    } else {
      await db.update(siemAlerts).set({ status: "failed", error: result.message }).where(eq(siemAlerts.id, alert.id));
      failed++;
    }
  }

  return { sent, failed };
}

export async function runSiemAlertWorkerOnce() {
  const queue = await queueSiemTelegramAlerts();
  const send = await sendPendingSiemTelegramAlerts();
  return { ...queue, ...send };
}
