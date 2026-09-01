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

// Editable PIC email alert subject: admins customize the subject line sent
// to PIC groups per NOT-OK findings. Supports group name, device counts, etc.
export const DEFAULT_EMAIL_ALERT_SUBJECT =
  "[DataGuard] {deviceCount} device(s) NOT OK — {siteName} — {checkDate} {shift}";

export const EMAIL_ALERT_SUBJECT_FIELDS = [
  "siteName",
  "siteCode",
  "checker",
  "shift",
  "checkDate",
  "checkTime",
  "groupName",
  "deviceCount",
  "deviceNames",
  "deviceName",
  "deviceStatus",
  "deviceLocation",
  "deviceCategory",
  "deviceBrand",
  "deviceZone",
  "deviceRack",
  "incidentId",
] as const;

export type EmailAlertSubjectField = typeof EMAIL_ALERT_SUBJECT_FIELDS[number];
export type EmailAlertSubjectContext = Partial<Record<EmailAlertSubjectField, string | number | null | undefined>>;

export function renderEmailSubject(
  template: string | null | undefined,
  context: EmailAlertSubjectContext,
): string {
  const source = template?.trim() || DEFAULT_EMAIL_ALERT_SUBJECT;
  return source.replace(/\{([a-zA-Z0-9]+)\}/g, (match, key: string) => {
    if (!EMAIL_ALERT_SUBJECT_FIELDS.includes(key as EmailAlertSubjectField)) return match;
    const val = context[key as EmailAlertSubjectField];
    if (val === undefined || val === null || val === "") return "-";
    return String(val);
  });
}

// SMTP resolution order: env SMTP_URL first (existing deployments, headless
// workers), then the structured Settings-UI fields (host/port/security/
// user/pass — Outlook-style form), then the legacy smtp_url column, then the
// localhost dev default. Transporters are cached per resolved config.
let transporter: nodemailer.Transporter | null = null;
let transporterUrl: string | null = null;

type StoredSmtp = {
  host: string | null;
  port: number | null;
  secure: "none" | "ssl" | "starttls" | null;
  user: string | null;
  pass: string | null; // decrypted
  legacyUrl: string | null; // decrypted legacy smtp_url
  from: string | null;
};

async function loadStoredSmtp(): Promise<StoredSmtp | null> {
  try {
    const rows = await db.select({
      smtpHost: globalSettings.smtpHost,
      smtpPort: globalSettings.smtpPort,
      smtpSecure: globalSettings.smtpSecure,
      smtpUser: globalSettings.smtpUser,
      smtpPass: globalSettings.smtpPass,
      smtpUrl: globalSettings.smtpUrl,
      smtpFrom: globalSettings.smtpFrom,
    }).from(globalSettings).limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      host: row.smtpHost?.trim() || null,
      port: row.smtpPort ?? null,
      secure: (row.smtpSecure as StoredSmtp["secure"]) ?? null,
      user: row.smtpUser?.trim() || null,
      pass: decryptIfEncrypted(row.smtpPass),
      legacyUrl: decryptIfEncrypted(row.smtpUrl),
      from: row.smtpFrom?.trim() || null,
    };
  } catch {
    return null; // DB unavailable or secret unset
  }
}

/** Build a nodemailer URL from the structured fields (SSL/STARTTLS/none). */
function smtpUrlFromFields(stored: StoredSmtp): string | null {
  if (!stored.host) return null;
  const auth = stored.user
    ? `${encodeURIComponent(stored.user)}:${encodeURIComponent(stored.pass ?? "")}@`
    : "";
  // ssl = implicit TLS (smtps), starttls/none = plain smtp + requireTLS flag.
  const scheme = stored.secure === "ssl" ? "smtps" : "smtp";
  const port = stored.port ?? (stored.secure === "ssl" ? 465 : stored.secure === "none" ? 25 : 587);
  return `${scheme}://${auth}${stored.host}:${port}`;
}

async function resolveSmtpUrl(): Promise<{ url: string; requireTls: boolean }> {
  const envUrl = getEnv().SMTP_URL?.trim();
  if (envUrl) return { url: envUrl, requireTls: false };

  const stored = await loadStoredSmtp();

  const structured = stored ? smtpUrlFromFields(stored) : null;
  if (structured) {
    return { url: structured, requireTls: stored!.secure === "starttls" };
  }
  if (stored?.legacyUrl?.trim()) {
    return { url: stored.legacyUrl.trim(), requireTls: false };
  }
  return { url: "smtp://localhost:1025", requireTls: false };
}

async function resolveSmtpFrom(): Promise<string> {
  const envFrom = getEnv().SMTP_FROM?.trim();
  if (envFrom) return envFrom;

  const stored = await loadStoredSmtp();
  return (
    stored?.from ||
    (stored?.user?.includes("@") ? stored.user : null) ||
    "siem@dc-check.local"
  );
}

async function getTransporter(): Promise<nodemailer.Transporter> {
  const { url, requireTls } = await resolveSmtpUrl();
  if (!transporter || transporterUrl !== url) {
    transporter = nodemailer.createTransport({
      url,
      // Internal DC relays routinely present self-signed certificates; strict
      // verification breaks them ("works in Outlook, fails here"). STARTTLS
      // still upgrades the connection before AUTH (requireTLS).
      tls: { rejectUnauthorized: false },
      requireTLS: requireTls,
    });
    transporterUrl = url;
  }
  return transporter;
}

/** True when SMTP is configured (env or Settings UI) — submissions skip PIC
 *  emails entirely otherwise. */
export async function isEmailConfigured(): Promise<boolean> {
  if (getEnv().SMTP_URL?.trim()) return true;

  const stored = await loadStoredSmtp();
  return Boolean(stored && (smtpUrlFromFields(stored) || stored.legacyUrl?.trim()));
}

/**
 * Drop the cached transporter so the next send rebuilds it from the current
 * stored config. Called after the Settings form saves SMTP fields — the
 * singleton is keyed on the resolved URL, but a same-URL password change
 * (URL identical, credentials different) would otherwise keep authenticating
 * with the old password.
 */
export function resetEmailTransporter() {
  transporter = null;
  transporterUrl = null;
}

export type EmailSendResult = {
  success: boolean;
  error?: string;
  /** Server's final DATA response (e.g. "250 2.0.0 Queued as ABC123"). */
  response?: string;
  /** Message-ID assigned by the client/server for mail-log searches. */
  messageId?: string;
  /** Actual envelope/header From address used for sending. */
  fromUsed?: string;
};

/**
 * Probe an SMTP account exactly as the user typed it in the Settings form —
 * before anything is saved. Used by the "Kirim Test Email" button so a failed
 * test reflects the config on screen, not a stale saved one. Builds its own
 * transporter (never touches the cached singleton). Mapping mirrors
 * smtpUrlFromFields + getTransporter.
 */
export async function sendTestEmail(
  to: string,
  subject: string,
  htmlBody: string,
  textBody: string,
  account: { host?: string; port?: number | null; secure?: string | null; user?: string | null; pass?: string | null; from?: string | null },
): Promise<EmailSendResult> {
  const host = account.host?.trim();
  // No host in the form → fall back to whatever is already configured
  // (env or previously-saved settings).
  if (!host) {
    return sendChecklistPicEmail([to], subject, htmlBody, textBody);
  }

  const scheme = account.secure === "ssl" ? "smtps" : "smtp";
  const port = account.port ?? (account.secure === "ssl" ? 465 : account.secure === "none" ? 25 : 587);
  const auth = account.user
    ? `${encodeURIComponent(account.user)}:${encodeURIComponent(account.pass ?? "")}@`
    : "";
  const url = `${scheme}://${auth}${host}:${port}`;
  const requireTls = account.secure !== "ssl" && account.secure !== "none";

  try {
    const transport = nodemailer.createTransport({
      url,
      tls: { rejectUnauthorized: false },
      requireTLS: requireTls,
    });
    const fromAddress =
      account.from?.trim() ||
      (account.user?.includes("@") ? account.user.trim() : null) ||
      (await resolveSmtpFrom());
    const info = await transport.sendMail({
      from: fromAddress,
      to,
      subject,
      text: textBody,
      html: htmlBody,
    });
    return { success: true, response: info.response, messageId: info.messageId, fromUsed: fromAddress };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

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
