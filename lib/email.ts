import "server-only";

import { db } from "../db";
import { deviceGroups, devicePics, users } from "../db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getEnv } from "./env";
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

export type PicEmailInput = {
  siteName: string;
  siteCode: string | null;
  checkDate: string;
  checkTime: string;
  shift: string;
  checker: string;
  /** One entry per PIC group — the To line is the group's member emails. */
  groups: {
    groupName: string;
    emails: string[];
    devices: PicEmailDevice[];
  }[];
  baseUrl: string;
};

/** Pure email builder: subject, body, and the summary snapshot for history. */
export function buildChecklistPicEmail(input: PicEmailInput) {
  const count = input.groups.reduce((sum, g) => sum + g.devices.length, 0);
  const subject = `[DataGuard] ${count} device${count === 1 ? "" : "s"} NOT OK — ${input.siteCode || input.siteName} — ${input.checkDate} ${input.shift}`;

  const files = input.groups.flatMap((group) =>
    group.devices.map((device) => {
      const rack = [device.rackName, device.rackPosition ? `U${device.rackPosition}` : null]
        .filter(Boolean).join(" ");
      const parts = [
        `• ${device.name}`,
        device.assetCode ? `(${device.assetCode})` : null,
        rack ? `— ${rack}` : null,
        device.categoryName ? `— ${device.categoryName}` : null,
        `— Remarks: ${device.remarks || "-"}`,
        device.incidentId ? `(Incident #${device.incidentId})` : null,
      ].filter(Boolean);
      return parts.join(" ");
    }),
  );

  const text = [
    `Hello,`,
    ``,
    `The following ${count} device${count === 1 ? " was" : "s were"} reported NOT OK in the checklist submitted at ${input.siteName} on ${input.checkDate} ${input.checkTime} (shift ${input.shift}) by ${input.checker}:`,
    ``,
    ...files,
    ``,
    `Details & follow-up: ${input.baseUrl}/admin/incidents`,
    ``,
    `This is an automated notification from DataGuard.`,
  ].join("\n");

  return { subject, text, deviceCount: count, deviceSummary: files.join("\n") };
}

// Lazy singleton keyed on the SMTP URL: created once per distinct relay, so
// a changed SMTP_URL env rebuilds instead of silently reusing the old client.
// nodemailer import is already proven safe in this bundle (lib/siem/alerts.ts
// uses the same pattern).
let transporter: nodemailer.Transporter | null = null;
let transporterUrl: string | null = null;

function getTransporter(): nodemailer.Transporter {
  const url = getEnv().SMTP_URL ?? "smtp://localhost:1025";
  if (!transporter || transporterUrl !== url) {
    transporter = nodemailer.createTransport(url);
    transporterUrl = url;
  }
  return transporter;
}

/** True when SMTP is configured — submissions skip PIC emails entirely otherwise. */
export function isEmailConfigured(): boolean {
  return Boolean(getEnv().SMTP_URL);
}

export type EmailSendResult = { success: boolean; error?: string };

/** Send one email (to = one or more recipient addresses). Never throws
 *  (same contract as sendTelegramAlert). */
export async function sendChecklistPicEmail(to: string[], subject: string, text: string): Promise<EmailSendResult> {
  try {
    await getTransporter().sendMail({
      from: getEnv().SMTP_FROM ?? "siem@dc-check.local",
      to: to.join(", "),
      subject,
      text,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
