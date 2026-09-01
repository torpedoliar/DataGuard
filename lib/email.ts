import "server-only";

import { db } from "../db";
import { deviceGroups, devicePics, globalSettings, users } from "../db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getEnv } from "./env";
import { decryptIfEncrypted } from "./crypto";
import nodemailer from "nodemailer";

// PIC alert emails: when a field audit (checklist submit) finds a device
// NOT OK, each device group bound to that device gets ONE email addressed
// to all of its owner users (device_pics → users.responsible_for_groups),
// listing the group's NOT-OK devices. A user owning two affected groups
// receives one email per group.

export type PicGroupRecipient = {
  groupId: number;
  groupName: string;
  /** Owner emails (deduped) — the To line of the group's single email. */
  emails: string[];
  /** Display names per email, keyed by email (for the history label). */
  memberNames: string[];
  deviceIds: number[];
};

/**
 * Resolve PIC group recipients for the given NOT-OK device ids: device →
 * bound group (active) → owner users (active, has an email) whose
 * responsible_for_groups jsonb contains the group id (stored as strings by
 * bindGroup). Returns one entry per distinct group with its deduped member
 * emails and affected device ids.
 */
export async function resolveChecklistPicRecipients(
  deviceIds: number[],
  siteId: number,
): Promise<Map<number, PicGroupRecipient>> {
  const byGroup = new Map<number, PicGroupRecipient>();
  if (deviceIds.length === 0) return byGroup;

  const rows = await db
    .select({
      deviceId: devicePics.deviceId,
      groupId: deviceGroups.id,
      groupName: deviceGroups.name,
      userId: users.id,
      email: users.email,
      username: users.username,
    })
    .from(devicePics)
    .innerJoin(deviceGroups, and(
      eq(devicePics.groupId, deviceGroups.id),
      eq(deviceGroups.isActive, true),
    ))
    .innerJoin(users, and(
      eq(users.isActive, true),
      isNotNull(users.email),
      // responsible_for_groups is a jsonb array of STRING group ids
      // (bindGroup stores String(groupId)), so containment must cast to text.
      sql`${users.responsibleForGroups} @> jsonb_build_array(${deviceGroups.id}::text)`,
    ))
    .where(and(
      inArray(devicePics.deviceId, deviceIds),
      eq(devicePics.siteId, siteId),
    ));

  for (const row of rows) {
    const email = row.email!;
    let entry = byGroup.get(row.groupId);
    if (!entry) {
      entry = {
        groupId: row.groupId,
        groupName: row.groupName,
        emails: [],
        memberNames: [],
        deviceIds: [],
      };
      byGroup.set(row.groupId, entry);
    }
    if (!entry.emails.includes(email)) {
      entry.emails.push(email);
      entry.memberNames.push(row.username);
    }
    if (!entry.deviceIds.includes(row.deviceId)) entry.deviceIds.push(row.deviceId);
  }
  return byGroup;
}

export type PicEmailDevice = {
  id: number;
  name: string;
  assetCode: string | null;
  rackName: string | null;
  rackPosition: number | null;
  categoryName: string | null;
  remarks: string;
  incidentId: number | null;
};

// ---- Editable email template (mirrors lib/telegram.ts) ----
//
// Admins customize the PIC alert email from Settings with the same {field}
// placeholder syntax as the Telegram template. The template renders ONE
// device per block — the checklist submit renders it per NOT-OK device of
// the group and joins the blocks. Body is HTML (nodemailer `html` field).

export const DEFAULT_EMAIL_ALERT_TEMPLATE = [
  "<b>Data Center Audit Alert</b>",
  "Site: {siteName} ({siteCode})",
  "Auditor: {checker}",
  "Shift: {shift}",
  "Time: {checkDate} {checkTime}",
  "",
  "<b>Device: {deviceName}</b>",
  "Asset Code: {deviceAssetCode}",
  "Status: {deviceStatus}",
  "Location: {deviceLocation}",
  "Category: {deviceCategory}",
  "Rack: {deviceRack}",
  "IP: {deviceIp}",
  "Remarks: {deviceRemarks}",
  "Open: {incidentLink}",
].join("\n");

// Same field set as TELEGRAM_ALERT_TEMPLATE_FIELDS — one shared context feeds
// both renderers from the checklist submit.
export const EMAIL_ALERT_TEMPLATE_FIELDS = [
  "siteName",
  "siteCode",
  "checker",
  "shift",
  "checkDate",
  "checkTime",
  "deviceName",
  "deviceAssetCode",
  "deviceStatus",
  "deviceLocation",
  "deviceCategory",
  "deviceBrand",
  "deviceZone",
  "deviceRack",
  "deviceIp",
  "deviceDescription",
  "deviceRemarks",
  "incidentId",
  "incidentLink",
] as const;

export type EmailAlertTemplateField = typeof EMAIL_ALERT_TEMPLATE_FIELDS[number];
export type EmailAlertTemplateContext = Partial<Record<EmailAlertTemplateField, string | number | null | undefined>>;

// Email bodies are HTML. Escape entity-supplied values, then convert
// newlines to <br> so multi-line remarks keep their shape.
function escapeEmailHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeEmailValue(value: string | number | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  return escapeEmailHtml(text).replace(/\n/g, "<br>");
}

/**
 * Render a trusted, server-generated Markdown link (`[label](url)`) into an
 * HTML anchor — same discipline as renderTelegramTemplate's trusted link:
 * only http(s) URLs pass; anything else is escaped as plain text.
 */
function renderTrustedEmailLink(value: string): string {
  const match = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(value.trim());
  if (!match) return escapeEmailHtml(value);
  const [, label, url] = match;
  return `<a href="${escapeEmailHtml(url)}">${escapeEmailHtml(label)}</a>`;
}

export function renderEmailTemplate(
  template: string | null | undefined,
  context: EmailAlertTemplateContext,
  options: { trustedLinkFields?: readonly ["incidentLink"] | readonly ("incidentLink")[] } = {},
) {
  const source = template?.trim() || DEFAULT_EMAIL_ALERT_TEMPLATE;
  const trustedLinkFields = new Set(options.trustedLinkFields ?? []);

  return source.replace(/\{([a-zA-Z0-9]+)\}/g, (match, key: string) => {
    if (!EMAIL_ALERT_TEMPLATE_FIELDS.includes(key as EmailAlertTemplateField)) return match;
    if (key === "incidentLink" && trustedLinkFields.has("incidentLink")) {
      return renderTrustedEmailLink(String(context.incidentLink ?? ""));
    }
    return normalizeEmailValue(context[key as EmailAlertTemplateField]);
  });
}

// SMTP resolution order: env SMTP_URL first (existing deployments, headless
// workers), then the Settings-UI value from global_settings (stored encrypted,
// decrypted here). Falls back to localhost:1025 only when neither is set.
let transporter: nodemailer.Transporter | null = null;
let transporterUrl: string | null = null;

async function resolveSmtpUrl(): Promise<string> {
  const envUrl = getEnv().SMTP_URL?.trim();
  if (envUrl) return envUrl;

  try {
    const rows = await db.select({ smtpUrl: globalSettings.smtpUrl }).from(globalSettings).limit(1);
    const stored = decryptIfEncrypted(rows[0]?.smtpUrl ?? null);
    if (stored?.trim()) return stored.trim();
  } catch {
    // DB unavailable or secret unset — fall through to the localhost default.
  }
  return "smtp://localhost:1025";
}

async function resolveSmtpFrom(): Promise<string> {
  const envFrom = getEnv().SMTP_FROM?.trim();
  if (envFrom) return envFrom;

  try {
    const rows = await db.select({ smtpFrom: globalSettings.smtpFrom }).from(globalSettings).limit(1);
    const stored = rows[0]?.smtpFrom?.trim();
    if (stored) return stored;
  } catch {
    // DB unavailable — fall through to the default sender.
  }
  return "siem@dc-check.local";
}

async function getTransporter(): Promise<nodemailer.Transporter> {
  const url = await resolveSmtpUrl();
  if (!transporter || transporterUrl !== url) {
    transporter = nodemailer.createTransport(url);
    transporterUrl = url;
  }
  return transporter;
}

/** True when SMTP is configured (env or Settings UI) — submissions skip PIC
 *  emails entirely otherwise. */
export async function isEmailConfigured(): Promise<boolean> {
  const envUrl = getEnv().SMTP_URL?.trim();
  if (envUrl) return true;

  try {
    const rows = await db.select({ smtpUrl: globalSettings.smtpUrl }).from(globalSettings).limit(1);
    return Boolean(decryptIfEncrypted(rows[0]?.smtpUrl ?? null)?.trim());
  } catch {
    return false;
  }
}

export type EmailSendResult = { success: boolean; error?: string };

export type EmailAttachment = { filename: string; content: Buffer; contentType: string };

/** Send one HTML email (to = one or more recipient addresses) with optional
 *  evidence-photo attachments. Never throws (same contract as
 *  sendTelegramAlert). textBody is the plain-text fallback for clients that
 *  block HTML. */
export async function sendChecklistPicEmail(
  to: string[],
  subject: string,
  htmlBody: string,
  textBody: string,
  attachments: EmailAttachment[] = [],
): Promise<EmailSendResult> {
  try {
    const [transporter, from] = await Promise.all([getTransporter(), resolveSmtpFrom()]);
    await transporter.sendMail({
      from,
      to: to.join(", "),
      subject,
      text: textBody,
      html: htmlBody,
      attachments: attachments.map(({ filename, content, contentType }) => ({
        filename,
        content,
        contentType,
      })),
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
