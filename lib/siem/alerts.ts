import { db } from "../../db";
import { siemAlerts, siemFindings, siemSettings, siteTelegramChatIds, siteWebhookUrls, siteEmailAddresses } from "../../db/schema";
import { escapeTelegramMarkdown, sendTelegramAlert } from "../telegram";
import { resolveNotificationBaseUrl } from "../notification-url";
import { and, eq, ne } from "drizzle-orm";
import { formatWibForAlert } from "../ui/datetime";
import { redactSensitiveText } from "./redaction";
import type { SiemSeverity } from "./types";
import nodemailer from "nodemailer";

const severityRank: Record<SiemSeverity, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };

function isAtLeastSeverity(value: SiemSeverity, minimum: SiemSeverity) {
  return severityRank[value] >= severityRank[minimum];
}

function alertMessage(input: { findingId: number; title: string; severity: SiemSeverity; siteName: string | null; deviceName: string | null; sourceIp: string | null; summary: string; recommendedAction: string | null; lastSeenAt: Date; baseUrl: string }) {
  // Entity-supplied values are Markdown-escaped (same discipline as
  // renderTelegramTemplate); the generated link and server-controlled fields
  // (severity enum, finding id, formatted date) stay raw so the deep link
  // remains clickable.
  const esc = (value: string | null | undefined, fallback: string) => {
    const text = value?.trim();
    return text ? escapeTelegramMarkdown(text) : fallback;
  };
  return redactSensitiveText([
    "*SIEM Finding*",
    `Severity: ${input.severity}`,
    `Last seen: ${formatWibForAlert(input.lastSeenAt)}`,
    `Site: ${esc(input.siteName, "-")}`,
    `Device: ${esc(input.deviceName, "Unmapped")}`,
    `Source: ${esc(input.sourceIp, "-")}`,
    `Finding: #${input.findingId} ${esc(input.title, "-")}`,
    `Open: [Open in SIEM](${input.baseUrl}/admin/siem/findings?severity=${input.severity})`,
    `Summary: ${esc(input.summary, "-")}`,
    `Action: ${esc(input.recommendedAction, "Review finding in SIEM dashboard.")}`,
  ].join("\n"));
}

export type SiteAlertRecipient = {
  recipient: string;
  severityFilter: string | null;
};

export async function resolveSiteTelegramRecipients(
  siteId: number,
  severity: SiemSeverity,
  legacyChatId: string | null | undefined,
): Promise<SiteAlertRecipient[]> {
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
    if (!legacy) return [];
    return [{ recipient: legacy, severityFilter: null }];
  }

  return rows
    .filter((row) => row.enabled)
    .filter((row) => {
      if (!row.severityFilter) return true;
      const allowed = row.severityFilter.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      return allowed.includes(severity);
    })
    .map((row) => ({ recipient: row.chatId, severityFilter: row.severityFilter }));
}

export async function resolveSiteWebhookRecipients(siteId: number, severity: SiemSeverity): Promise<SiteAlertRecipient[]> {
  const rows = await db.select({ url: siteWebhookUrls.url, severityFilter: siteWebhookUrls.severityFilter, enabled: siteWebhookUrls.enabled })
    .from(siteWebhookUrls).where(eq(siteWebhookUrls.siteId, siteId));
  return rows.filter((r) => r.enabled).filter((r) => {
    if (!r.severityFilter) return true;
    return r.severityFilter.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).includes(severity);
  }).map(r => ({ recipient: r.url, severityFilter: r.severityFilter }));
}

export async function resolveSiteEmailRecipients(siteId: number, severity: SiemSeverity): Promise<SiteAlertRecipient[]> {
  const rows = await db.select({ email: siteEmailAddresses.email, severityFilter: siteEmailAddresses.severityFilter, enabled: siteEmailAddresses.enabled })
    .from(siteEmailAddresses).where(eq(siteEmailAddresses.siteId, siteId));
  return rows.filter((r) => r.enabled).filter((r) => {
    if (!r.severityFilter) return true;
    return r.severityFilter.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).includes(severity);
  }).map(r => ({ recipient: r.email, severityFilter: r.severityFilter }));
}

export async function queueSiemAlerts() {
  // Findings are processed across all sites (headless worker); each finding's
  // alert-min-severity is read from its own site's siem_settings, not a global
  // singleton.
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
  let skipped = 0;
  for (const finding of rows) {
    try {
      if (!finding.rule?.alertEnabled) continue;

      if (!finding.site) continue;
      const siteId = finding.site.id;

      const [settings] = await db.select().from(siemSettings).where(eq(siemSettings.siteId, siteId)).limit(1);
      const minSeverity = (settings?.alertMinSeverity ?? "High") as SiemSeverity;
      if (!isAtLeastSeverity(finding.severity as SiemSeverity, minSeverity)) continue;

      const severity = finding.severity as SiemSeverity;
      const [tRecs, wRecs, eRecs] = await Promise.all([
        resolveSiteTelegramRecipients(siteId, severity, finding.site.telegramChatId),
        resolveSiteWebhookRecipients(siteId, severity),
        resolveSiteEmailRecipients(siteId, severity),
      ]);

      if (tRecs.length === 0 && wRecs.length === 0 && eRecs.length === 0) continue;

      const message = alertMessage({
        findingId: finding.id,
        title: finding.title,
        severity,
        siteName: finding.site?.name ?? "Unknown",
        deviceName: finding.device?.name ?? null,
        sourceIp: finding.source?.sourceIp ?? null,
        summary: finding.humanAnalysis ?? finding.summary,
        recommendedAction: finding.recommendedAction,
        lastSeenAt: finding.lastSeenAt,
        baseUrl: await resolveNotificationBaseUrl(),
      });

      const queueForChannel = async (channel: "telegram" | "webhook" | "email", recipients: SiteAlertRecipient[]) => {
        for (const { recipient } of recipients) {
          // A pending or sent row already covers this (finding, channel,
          // recipient); a row that permanently FAILED must not block a fresh
          // queue pass (e.g. after a worker restart or a long outage), so it
          // is excluded here and re-queued as a new pending row.
          if (finding.alerts.some(
            (a) => a.channel === channel && a.recipient === recipient && a.status !== "failed",
          )) continue;
          await db.insert(siemAlerts).values({
            findingId: finding.id,
            channel,
            recipient,
            status: "pending",
            message,
          });
          queued++;
        }
      };

      await queueForChannel("telegram", tRecs);
      await queueForChannel("webhook", wRecs);
      await queueForChannel("email", eRecs);
    } catch (error) {
      console.error(`SIEM alert queue failed for finding ${finding.id}, skipping`, error);
      skipped++;
    }
  }

  return { queued };
}

// Retry budget: initial attempt + MAX_SEND_RETRIES retries, then the row is
// marked 'failed' (which the queue dedupe ignores, so a later queue pass can
// re-queue it — alerts are never dropped permanently).
const MAX_SEND_RETRIES = 4;
// Exponential backoff base. Anchored on the row's createdAt (the only
// timestamp siem_alerts carries; no migration) so a failed alert waits
// base*2^retryCount before its next attempt instead of hammering every
// 15s worker tick. First attempt (retryCount 0) is immediate.
const RETRY_BACKOFF_BASE_MS = 15_000;

export async function sendPendingSiemAlerts() {
  const alerts = await db.select().from(siemAlerts)
    .where(eq(siemAlerts.status, "pending"))
    .limit(25);

  let sent = 0;
  let failed = 0;

  // Create transporter once if needed
  let transporter: nodemailer.Transporter | null = null;
  if (alerts.some(a => a.channel === "email")) {
    transporter = nodemailer.createTransport(process.env.SMTP_URL || "smtp://localhost:1025");
  }

  for (const alert of alerts) {
    const currentRetries = alert.retryCount ?? 0;

    // Backoff gate: a retried alert is only eligible once its exponential
    // window (from creation) has elapsed. Skipped rows stay pending for a
    // later tick.
    if (currentRetries > 0 && alert.createdAt) {
      const backoffMs = RETRY_BACKOFF_BASE_MS * 2 ** currentRetries;
      if (Date.now() - alert.createdAt.getTime() < backoffMs) continue;
    }

    let success = false;
    let errorMsg = "";

    try {
      if (alert.channel === "telegram" && alert.recipient) {
        const result = await sendTelegramAlert(alert.recipient, alert.message);
        success = result.success;
        errorMsg = result.message || "Unknown error";
      } else if (alert.channel === "webhook" && alert.recipient) {
        const res = await fetch(alert.recipient, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: alert.message })
        });
        success = res.ok;
        if (!success) errorMsg = `HTTP ${res.status} ${res.statusText}`;
      } else if (alert.channel === "email" && alert.recipient && transporter) {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || "siem@dc-check.local",
          to: alert.recipient,
          subject: `SIEM Alert: Finding #${alert.findingId}`,
          text: alert.message,
        });
        success = true;
      }
    } catch (error: any) {
      success = false;
      errorMsg = error?.message || "Exception occurred";
    }

    if (success) {
      await db.update(siemAlerts).set({ status: "sent", sentAt: new Date(), error: null }).where(eq(siemAlerts.id, alert.id));
      sent++;
    } else {
      if (currentRetries < MAX_SEND_RETRIES) {
        await db.update(siemAlerts).set({ retryCount: currentRetries + 1, error: errorMsg }).where(eq(siemAlerts.id, alert.id));
      } else {
        await db.update(siemAlerts).set({ status: "failed", error: errorMsg }).where(eq(siemAlerts.id, alert.id));
      }
      failed++;
    }
  }

  return { sent, failed };
}

export async function runSiemAlertWorkerOnce() {
  const queue = await queueSiemAlerts();
  const send = await sendPendingSiemAlerts();
  return { ...queue, ...send };
}
