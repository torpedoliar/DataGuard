
"use server";

import { db } from "../db";
import { checklistEntries, checklistItems, users, sites, devices, siteTelegramChatIds, incidents, incidentUpdates, emailAlerts, locations } from "../db/schema";
import { createIncidentsForChecklistItems } from "@/actions/incidents";
import { getTelegramAlertTemplate, getEmailAlertTemplate, getEmailAlertSubject } from "@/actions/settings";
import { escapeTelegramHtml, renderTelegramTemplate, sendTelegramAlert, sendTelegramPhoto, splitTelegramChunks } from "@/lib/telegram";
import { resolveNotificationBaseUrl } from "@/lib/notification-url";
import { isEmailConfigured, renderEmailTemplate, renderEmailSubject, resolveChecklistPicRecipients, sendChecklistPicEmail, type EmailAttachment } from "@/lib/email";
import { hasAdminAccess } from "../lib/site-access";
import { requireActiveSiteAction } from "../lib/action-auth";
import { logAudit } from "../lib/audit";
import { revalidatePath } from "next/cache";
import { deleteUploadFile, resolveStoredUploadPath, saveUploadFile, UploadValidationError, validateUpload } from "../lib/upload";
import { eq, and, or, desc, sql, inArray } from "drizzle-orm";
import fs from "node:fs/promises";

const SEVERITY_RANK = { Low: 1, Medium: 2, High: 3, Critical: 4 } as const;
type ChecklistSeverity = keyof typeof SEVERITY_RANK;

/**
 * Load a NOT-OK device's evidence photo from the upload dir (server-side
 * path via resolveStoredUploadPath — the public URL is internal-only, so
 * Telegram must receive raw bytes, and email wants a Buffer attachment).
 * Returns null when the item has no photo or the file is gone.
 */
async function loadEvidencePhoto(photoPath: string | null | undefined): Promise<Buffer | null> {
    if (!photoPath) return null;
    const filePath = resolveStoredUploadPath(photoPath);
    if (!filePath) return null;
    try {
        return await fs.readFile(filePath);
    } catch {
        return null; // missing/unreadable file — send the alert without it
    }
}

async function validateChecklistPhotos(formData: FormData, deviceIds: number[]) {
    for (const deviceId of deviceIds) {
        const photoFile = formData.get(`photo-${deviceId}`) as File;
        if (photoFile && photoFile.size > 0 && photoFile.name !== "undefined") {
            await validateUpload(photoFile, { kind: "photo", directory: "root" });
        }
    }
}

async function resolveChecklistRecipients(siteId: number, severity: ChecklistSeverity, legacyChatId: string | null | undefined) {
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

export async function submitChecklist(prevState: unknown, formData: FormData) {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return { message: auth.message };
    const session = auth.session;

    try {
        // 1. Extract common data
        const checkDate = formData.get("checkDate") as string;
        const checkTime = formData.get("checkTime") as string;
        const shift = formData.get("shift") as "Pagi" | "Siang" | "Malam";

        if (!checkDate || !checkTime || !shift) {
            return { message: "Date, Time, and Shift are required" };
        }

        // Deduplicate: the same device can appear twice in the form (visible
        // card + hidden all-devices block). One item row per (entry, device)
        // is enforced by the unique index; the alert/incident sub-flow must
        // not run twice for a device either.
        const deviceIds = [...new Set(
            formData.getAll("deviceId")
                .map((id) => Number(id))
                .filter((id) => Number.isInteger(id)),
        )];
        // Scoped audit (per category/rack tab) submits a subset by design; an
        // EMPTY set is the only invalid one (empty scope tab, offline replay
        // of a queue item whose items array was lost).
        if (deviceIds.length === 0) {
            return { message: "No devices selected. Pick a scope tab that has devices, or use \"All\"." };
        }
        await validateChecklistPhotos(formData, deviceIds);

        // Finding #44: reject device ids that do not belong to the active site
        // BEFORE any insert. The incident sub-flow silently skips out-of-site
        // devices, so unchecked ids would leave checklist rows with no derived
        // incidents; rejecting the whole submit keeps records and incidents
        // aligned.
        // Finding #44 extension: a device excluded from the checklist (form
        // open before the admin flipped the flag) also must not be submitted —
        // including it would count it against the population and break the
        // ≤100% invariant.
        const siteDevices = await db.select({ id: devices.id }).from(devices)
            .where(and(inArray(devices.id, deviceIds), eq(devices.siteId, auth.activeSiteId)));
        if (siteDevices.length !== deviceIds.length) {
            return { message: "Some devices are not valid for the active site. Reload the page and try again." };
        }
        const excludedCount = await db.select({ count: sql<number>`count(*)::int` }).from(devices)
            .where(and(inArray(devices.id, deviceIds), eq(devices.siteId, auth.activeSiteId), eq(devices.excludeChecklist, true)));
        if ((excludedCount[0]?.count ?? 0) > 0) {
            return { message: "Sebagian perangkat telah dikecualikan dari checklist. Muat ulang halaman untuk daftar terbaru." };
        }

        // 2. Create entry + per-device items + incidents atomically (finding #08):
        //    a mid-loop failure rolls back the whole submit, and a retry is
        //    idempotent (unique (entry_id, device_id) index + onConflictDoNothing
        //    on items; incidents dedupe on the unique checklist_item_id).
        const alertItems: { checklistItemId: number; deviceId: number; status: "NOT OK"; remarks: string; photoPath: string | null }[] = [];
        const incidentItems: {
            checklistItemId: number;
            deviceId: number;
            status: "NOT OK";
            remarks: string;
            photoPath: string | null;
        }[] = [];
        let entryId = 0;
        let createdIncidents: Awaited<ReturnType<typeof createIncidentsForChecklistItems>> = [];

        // Room-temperature readings from the form: { roomTemp-<locationId> }.
        // Only rooms the admin configured with a threshold accept input;
        // readings are validated against that location's site + threshold.
        // Over threshold+3 → a synthetic NOT-OK "device" (the room) joins the
        // normal alert/incident/notification flow so nothing downstream
        // changes.
        const tempInputs = new Map<number, number>();
        for (const [key, value] of formData.entries()) {
            if (!key.startsWith("roomTemp-") || typeof value !== "string" || !value.trim()) continue;
            const locationId = Number(key.slice("roomTemp-".length));
            const parsed = Number(value);
            if (Number.isInteger(locationId) && Number.isFinite(parsed)) {
                tempInputs.set(locationId, parsed);
            }
        }
        const measuredLocations = tempInputs.size > 0
            ? await db.select({
                id: locations.id,
                name: locations.name,
                tempThresholdC: locations.tempThresholdC,
            }).from(locations).where(and(
                inArray(locations.id, [...tempInputs.keys()]),
                eq(locations.siteId, auth.activeSiteId),
            ))
            : [];
        const locationTempsSnapshot: Record<string, { tempC: number; thresholdC: number; locationName: string }> = {};
        const tempIncidentItems: { locationId: number; locationName: string; tempC: number; thresholdC: number }[] = [];
        for (const location of measuredLocations) {
            const tempC = tempInputs.get(location.id)!;
            const thresholdC = location.tempThresholdC ?? 27;
            locationTempsSnapshot[String(location.id)] = { tempC, thresholdC, locationName: location.name };
            if (tempC > thresholdC + 3) {
                tempIncidentItems.push({ locationId: location.id, locationName: location.name, tempC, thresholdC });
            }
        }

        // Check if an entry already exists for this site and date.
        // Audit should only be once a day per site: if an audit already exists for checkDate,
        // merge/update into it rather than creating a duplicate entry with multiple auditors.
        const existingEntry = await db.query.checklistEntries.findFirst({
            where: and(
                eq(checklistEntries.siteId, auth.activeSiteId),
                eq(checklistEntries.checkDate, checkDate),
            ),
        });

        await db.transaction(async (tx) => {
            for (const location of measuredLocations) {
                const tempC = tempInputs.get(location.id)!;
                await tx.update(locations).set({ tempC }).where(eq(locations.id, location.id));
            }

            if (existingEntry) {
                entryId = existingEntry.id;
                await tx.update(checklistEntries).set({
                    checkTime,
                    shift,
                    locationTemps: { ...(existingEntry.locationTemps || {}), ...locationTempsSnapshot },
                }).where(eq(checklistEntries.id, entryId));
            } else {
                const [entry] = await tx.insert(checklistEntries).values({
                    siteId: auth.activeSiteId,
                    userId: session.userId,
                    checkDate,
                    checkTime,
                    shift,
                    locationTemps: locationTempsSnapshot,
                }).returning();
                entryId = entry.id;
            }

            // If updating an existing entry, query existing items to update in-place
            const existingItems = existingEntry
                ? await tx.query.checklistItems.findMany({ where: eq(checklistItems.entryId, entryId) })
                : [];
            const existingItemByDevice = new Map(existingItems.map((item) => [item.deviceId, item]));

            // Room over threshold+3: synthetic NOT-OK item. deviceId is
            // NOT NULL on checklist_items/incidents, so rooms without a
            // device in this audit can't anchor a row — the breach is
            // recorded in entry.locationTemps (above) and, for rooms that
            // DO have audited devices, folded into that device's remarks
            // below so it still reaches notifications.
            if (tempIncidentItems.length > 0) {
                for (const temp of tempIncidentItems) {
                    const anchorDeviceId = deviceIds.find((deviceId) => {
                        const device = siteDevices.find((s) => s.id === deviceId);
                        return Boolean(device);
                    });
                    const anchorAlert = alertItems.find((a) => a.deviceId === anchorDeviceId);
                    const note = `[SUHU RUANGAN] ${temp.locationName}: ${temp.tempC}°C (batas ${temp.thresholdC}°C)`;
                    if (anchorAlert && !anchorAlert.remarks.includes("[SUHU RUANGAN]")) {
                        anchorAlert.remarks = `${note}\n${anchorAlert.remarks}`;
                    }
                }
            }

            for (const deviceId of deviceIds) {
                const status = formData.get(`status-${deviceId}`) as "OK" | "NOT OK";
                const remarks = formData.get(`remarks-${deviceId}`) as string;
                const photoFile = formData.get(`photo-${deviceId}`) as File;

                let photoPath = null;

                // 4. Handle File Upload if exists (disk writes inside the tx;
                //    a rollback can leave an orphan file but never a partial submit)
                if (photoFile && photoFile.size > 0 && photoFile.name !== "undefined") {
                    photoPath = await saveUploadFile(
                        photoFile,
                        `${entryId}-${deviceId}`,
                        { kind: "photo", directory: "root" },
                    );
                }

                const normalizedStatus = (status || "OK") as "OK" | "NOT OK";
                const existing = existingItemByDevice.get(deviceId);
                let itemId: number | null = null;

                if (existing) {
                    itemId = existing.id;
                    await tx.update(checklistItems).set({
                        status: normalizedStatus,
                        remarks: remarks || "",
                        photoPath: photoPath ?? existing.photoPath,
                    }).where(eq(checklistItems.id, existing.id));
                } else {
                    const [item] = await tx.insert(checklistItems).values({
                        entryId,
                        deviceId,
                        status: normalizedStatus,
                        remarks: remarks || "",
                        photoPath,
                    }).onConflictDoNothing({ target: [checklistItems.entryId, checklistItems.deviceId] }).returning();
                    if (item) itemId = item.id;
                }

                if (!itemId) continue;

                if (normalizedStatus === "NOT OK") {
                    alertItems.push({ checklistItemId: itemId, deviceId, status: normalizedStatus, remarks: remarks || "No remarks provided", photoPath: photoPath ?? existing?.photoPath ?? null });
                    incidentItems.push({
                        checklistItemId: itemId,
                        deviceId,
                        status: normalizedStatus,
                        remarks: remarks || "No remarks provided",
                        photoPath: photoPath ?? existing?.photoPath ?? null,
                    });
                }
            }

            createdIncidents = await createIncidentsForChecklistItems({
                siteId: auth.activeSiteId,
                userId: session.userId,
                items: incidentItems,
            }, tx);
        });

        // Audit row is written before dispatch (which is fire-and-forget), so
        // it can't report email/telegram send counts — those live in
        // email_alerts / TELEGRAM_SEND audit rows instead.
        await logAudit({
            action: "CREATE",
            entity: "checklist",
            entityId: entryId,
            entityName: `${checkDate} ${shift}`,
            detail: `Checklist submitted with ${deviceIds.length} items, ${alertItems.length} alerts`,
        });

        // 5. Dispatch Telegram Alerts (if applicable)
        if (alertItems.length > 0) {
            try {
                const [site, user, telegramTemplate] = await Promise.all([
                    db.query.sites.findFirst({ where: eq(sites.id, auth.activeSiteId) }),
                    db.query.users.findFirst({ where: eq(users.id, session.userId) }),
                    getTelegramAlertTemplate(),
                ]);

                const recipients = await resolveChecklistRecipients(
                    auth.activeSiteId,
                    // Finding #56: alertItems only ever contains NOT-OK items,
                    // so the previous `some(...) ? "Medium" : "Low"` ternary was
                    // dead code. The checklist form collects no per-device
                    // severity, and incident creation derives NOT-OK → Medium
                    // (getDefaultIncidentSeverity in lib/incidents.ts), so
                    // checklist alerts are uniformly Medium for filter purposes.
                    "Medium",
                    site?.telegramChatId,
                );

                // Shared by the Telegram render below and the PIC email body —
                // one query for the NOT-OK devices.
                const failedIds = alertItems.map(a => a.deviceId);
                const devicesInfo = await db.query.devices.findMany({
                    where: inArray(devices.id, failedIds),
                    with: { brand: true, category: true, location: true }
                });
                const incidentByChecklistItemId = new Map(
                    createdIncidents.map((incident) => [incident.checklistItemId, incident]),
                );
                const baseUrl = await resolveNotificationBaseUrl();

                if (site && recipients.length > 0) {
                    const messages = alertItems.map((alert) => {
                        const dev = devicesInfo.find(d => d.id === alert.deviceId);
                        const rack = [dev?.rackName, dev?.rackPosition ? `U${dev.rackPosition}` : null].filter(Boolean).join(" ");
                        const incident = incidentByChecklistItemId.get(alert.checklistItemId);

                        return renderTelegramTemplate(telegramTemplate, {
                            siteName: site.name,
                            siteCode: site.code,
                            checker: user?.username || "Unknown",
                            shift,
                            checkDate,
                            checkTime,
                            deviceName: dev?.name || `Device #${alert.deviceId}`,
                            deviceAssetCode: dev?.assetCode,
                            deviceStatus: alert.status,
                            deviceLocation: dev?.location?.name,
                            deviceCategory: dev?.category?.name,
                            deviceBrand: dev?.brand?.name,
                            deviceZone: dev?.zone,
                            deviceRack: rack,
                            deviceIp: dev?.ipAddress,
                            deviceDescription: dev?.description,
                            deviceRemarks: alert.remarks,
                            incidentId: incident?.id ? `#${incident.id}` : "-",
                            incidentLink: incident?.id
                                ? `[Open incident #${incident.id}](${baseUrl}/admin/incidents/${incident.id})`
                                : "-",
                        }, {
                            trustedMarkdownFields: ["incidentLink"],
                        });
                    });
                    // Chat API drops messages over 4096 chars; split on
                    // device-block separators (finding #22).
                    const chunks = splitTelegramChunks(messages);

                    // Evidence photos for the NOT-OK devices that have one:
                    // loaded eagerly (small, capped) so the async dispatch
                    // below never touches the filesystem after the action
                    // returns. Each photo is sent as a captioned follow-up
                    // message per recipient.
                    const photoByDevice = new Map<number, Buffer>();
                    for (const alert of alertItems) {
                        if (!alert.photoPath || photoByDevice.has(alert.deviceId)) continue;
                        const buffer = await loadEvidencePhoto(alert.photoPath);
                        if (buffer) photoByDevice.set(alert.deviceId, buffer);
                    }

                    // Async dispatch so we don't block the UI response. Each chunk send is
                    // audited (finding #59) — chatId + success/failure — so
                    // outbound notifications leave a trail; logAudit never
                    // throws and the send still never blocks the caller.
                    for (const recipient of recipients) {
                        for (const chunk of chunks) {
                            sendTelegramAlert(recipient.chatId, chunk)
                                .then((result) => {
                                    void logAudit({
                                        action: "TELEGRAM_SEND",
                                        entity: "checklist",
                                        entityId: entryId,
                                        entityName: `${checkDate} ${shift}`,
                                        detail: `chatId=${recipient.chatId} success=${result.success}${result.message ? `: ${result.message}` : ""} (${chunk.length} chars)`,
                                    });
                                    if (!result.success) {
                                        console.error(`Telegram alert send failed for chatId=${recipient.chatId}:`, result.message);
                                    }
                                })
                                .catch((error) => {
                                    console.error("Failed to send telegram alert:", error);
                                    void logAudit({
                                        action: "TELEGRAM_SEND",
                                        entity: "checklist",
                                        entityId: entryId,
                                        entityName: `${checkDate} ${shift}`,
                                        detail: `chatId=${recipient.chatId} error=${String(error)}`,
                                    });
                                });
                        }
                        // Photo follow-ups (only devices whose evidence file
                        // loaded) — same fire-and-forget contract.
                        for (const alert of alertItems) {
                            const photo = photoByDevice.get(alert.deviceId);
                            if (!photo) continue;
                            const dev = devicesInfo.find(d => d.id === alert.deviceId);
                            sendTelegramPhoto(
                                recipient.chatId,
                                photo,
                                `evidence-${alert.deviceId}.jpg`,
                                `<b>${escapeTelegramHtml(dev?.name || `Device #${alert.deviceId}`)}</b> — evidence photo`,
                            )
                                .then((result) => {
                                    if (!result.success) {
                                        console.error(`Telegram photo send failed for chatId=${recipient.chatId}:`, result.message);
                                        void logAudit({
                                            action: "TELEGRAM_SEND",
                                            entity: "checklist",
                                            entityId: entryId,
                                            entityName: `${checkDate} ${shift}`,
                                            detail: `chatId=${recipient.chatId} photo device=${alert.deviceId} failed: ${result.message ?? "unknown"}`,
                                        });
                                    }
                                })
                                .catch((error) => {
                                    console.error("Failed to send telegram photo:", error);
                                });
                        }
                    }
                }

                // PIC email alerts: each device group bound to a NOT-OK device
                // gets ONE email addressed to all of its owner users. Body is
                // rendered from the editable template (Settings, same {field}
                // syntax as Telegram) once per device, blocks joined with a
                // separator. Skipped entirely when SMTP is unset.
                if (await isEmailConfigured() && site) {
                    try {
                        const picGroups = await resolveChecklistPicRecipients(failedIds, auth.activeSiteId);
                        const [emailTemplate, emailSubjectTemplate] = await Promise.all([
                            getEmailAlertTemplate(),
                            getEmailAlertSubject(),
                        ]);

                        for (const [, group] of picGroups) {
                            const deviceBlocks: { html: string; text: string; deviceName: string }[] = [];

                            for (const deviceId of group.deviceIds) {
                                const dev = devicesInfo.find(d => d.id === deviceId);
                                const alert = alertItems.find((a) => a.deviceId === deviceId);
                                const incident = incidentByChecklistItemId.get(alert?.checklistItemId ?? 0);
                                const rack = [dev?.rackName, dev?.rackPosition ? `U${dev.rackPosition}` : null].filter(Boolean).join(" ");

                                const context = {
                                    siteName: site.name,
                                    siteCode: site.code,
                                    checker: user?.username || "Unknown",
                                    shift,
                                    checkDate,
                                    checkTime,
                                    deviceName: dev?.name || `Device #${deviceId}`,
                                    deviceAssetCode: dev?.assetCode,
                                    deviceStatus: alert?.status ?? "NOT OK",
                                    deviceLocation: dev?.location?.name,
                                    deviceCategory: dev?.category?.name,
                                    deviceBrand: dev?.brand?.name,
                                    deviceZone: dev?.zone,
                                    deviceRack: rack,
                                    deviceIp: dev?.ipAddress,
                                    deviceDescription: dev?.description,
                                    deviceRemarks: alert?.remarks,
                                    incidentId: incident?.id ? `#${incident.id}` : "-",
                                    incidentLink: incident?.id
                                        ? `[Open incident #${incident.id}](${baseUrl}/admin/incidents/${incident.id})`
                                        : "-",
                                };

                                deviceBlocks.push({
                                    html: renderEmailTemplate(emailTemplate, context, { trustedLinkFields: ["incidentLink"] }),
                                    // Plain-text twin: same template, tags stripped
                                    // (regex is fine — only our own <b>/<a>/<br> tags
                                    // ever appear in the rendered output).
                                    text: renderEmailTemplate(emailTemplate, context, { trustedLinkFields: [] })
                                        .replace(/<br\s*\/?>/gi, "\n")
                                        .replace(/<[^>]+>/g, "")
                                        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'"),
                                    deviceName: context.deviceName,
                                });
                            }

                            const firstDev = devicesInfo.find((d) => group.deviceIds.includes(d.id));
                            const subject = renderEmailSubject(emailSubjectTemplate, {
                                siteName: site.name,
                                siteCode: site.code,
                                checker: user?.username || "Unknown",
                                shift,
                                checkDate,
                                checkTime,
                                groupName: group.groupName,
                                deviceCount: deviceBlocks.length,
                                deviceNames: deviceBlocks.map((b) => b.deviceName).join(", "),
                                deviceName: deviceBlocks[0]?.deviceName ?? "",
                                deviceStatus: "NOT OK",
                                deviceLocation: firstDev?.location?.name,
                                deviceCategory: firstDev?.category?.name,
                                deviceBrand: firstDev?.brand?.name,
                                deviceZone: firstDev?.zone,
                                deviceRack: [firstDev?.rackName, firstDev?.rackPosition ? `U${firstDev.rackPosition}` : null].filter(Boolean).join(" "),
                            });
                            const htmlBody = [
                                ...deviceBlocks.map((block) => block.html),
                                `<br><a href="${baseUrl}/admin/incidents">Details &amp; follow-up</a>`,
                            ].join("<br><br>");
                            const textBody = [
                                ...deviceBlocks.map((block) => block.text),
                                `Details & follow-up: ${baseUrl}/admin/incidents`,
                            ].join("\n\n");
                            const deviceSummary = deviceBlocks
                                .map((block) => `• ${block.deviceName}`)
                                .join("\n");

                            // Evidence photos of the group's NOT-OK devices as
                            // email attachments (photo shared once per group).
                            const attachments: EmailAttachment[] = [];
                            for (const alert of alertItems.filter((a) => group.deviceIds.includes(a.deviceId))) {
                                if (!alert.photoPath) continue;
                                const buffer = await loadEvidencePhoto(alert.photoPath);
                                if (!buffer) continue;
                                const extension = alert.photoPath.split(".").pop()?.toLowerCase() || "jpg";
                                attachments.push({
                                    filename: `evidence-device-${alert.deviceId}.${extension}`,
                                    content: buffer,
                                    contentType: extension === "png" ? "image/png"
                                        : extension === "webp" ? "image/webp"
                                        : extension === "gif" ? "image/gif"
                                        : "image/jpeg",
                                });
                            }

                            // Fire-and-forget like Telegram; the history row is
                            // written once with a terminal status. recipient
                            // stores the group's full To line; recipientName
                            // the group name.
                            void sendChecklistPicEmail(group.emails, subject, htmlBody, textBody, attachments)
                                .then((result) => {
                                    void db.insert(emailAlerts).values({
                                        siteId: auth.activeSiteId,
                                        entryId,
                                        recipient: group.emails.join(", "),
                                        recipientName: group.groupName,
                                        subject,
                                        deviceCount: deviceBlocks.length,
                                        deviceSummary,
                                        status: result.success ? "sent" : "failed",
                                        error: result.error ?? null,
                                        sentAt: result.success ? new Date() : null,
                                    }).catch((insertError) => {
                                        console.error("Failed to record email_alerts row:", insertError);
                                    });
                                    if (!result.success) {
                                        console.error(`PIC email send failed for group ${group.groupName}:`, result.error);
                                    }
                                })
                                .catch((error) => {
                                    console.error("Failed to send PIC email:", error);
                                    void db.insert(emailAlerts).values({
                                        siteId: auth.activeSiteId,
                                        entryId,
                                        recipient: group.emails.join(", "),
                                        recipientName: group.groupName,
                                        subject,
                                        deviceCount: deviceBlocks.length,
                                        deviceSummary,
                                        status: "failed",
                                        error: String(error),
                                    }).catch(() => { /* history is best-effort */ });
                                });
                        }
                    } catch (emailError) {
                        console.error("Failed to dispatch PIC emails:", emailError);
                    }
                }
            } catch (e) {
                console.error("Failed to dispatch telegram alerts:", e);
            }
        }

        revalidatePath("/admin/incidents");
        revalidatePath("/checklist");
        revalidatePath("/report");
        return { success: true };

    } catch (error) {
        console.error("Submit checklist error:", error);
        if (error instanceof UploadValidationError) return { message: error.message };
        return { message: "Failed to submit checklist" };
    }
}

// Get checklist entry with items for editing
export async function getChecklistEntry(entryId: number) {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return null;
    const session = auth.session;

    const entry = await db.query.checklistEntries.findFirst({
        where: and(eq(checklistEntries.id, entryId), eq(checklistEntries.siteId, auth.activeSiteId)),
        with: {
            items: {
                with: {
                    device: true,
                },
            },
            user: true,
        },
    });

    if (!entry) return null;

    // Only allow owner or admin to edit
    const canAdminister = await hasAdminAccess();
    if (entry.userId !== session.userId && !canAdminister) {
        return null;
    }

    return entry;
}

// Update checklist entry
export async function updateChecklist(prevState: unknown, formData: FormData) {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return { message: auth.message };
    const session = auth.session;

    const entryId = Number(formData.get("entryId"));
    if (!entryId) {
        return { message: "Invalid entry ID" };
    }

    // Verify ownership
    const entry = await db.query.checklistEntries.findFirst({
        where: and(eq(checklistEntries.id, entryId), eq(checklistEntries.siteId, auth.activeSiteId)),
    });

    const canAdminister = await hasAdminAccess();
    if (!entry || (entry.userId !== session.userId && !canAdminister)) {
        return { message: "Unauthorized" };
    }

    try {
        const deviceIds = [...new Set(
            formData.getAll("deviceId")
                .map((id) => Number(id))
                .filter((id) => Number.isInteger(id)),
        )];
        if (deviceIds.length === 0) {
            return { message: "No devices selected." };
        }
        await validateChecklistPhotos(formData, deviceIds);

        // Finding #44: same site scoping as submitChecklist — foreign device
        // ids must never reach checklist_items (or the derived incidents).
        const siteDevices = await db.select({ id: devices.id }).from(devices)
            .where(and(inArray(devices.id, deviceIds), eq(devices.siteId, auth.activeSiteId)));
        if (siteDevices.length !== deviceIds.length) {
            return { message: "Some devices are not valid for the active site. Reload the page and try again." };
        }

        const checkDate = formData.get("checkDate") as string;
        const checkTime = formData.get("checkTime") as string;
        const shift = formData.get("shift") as "Pagi" | "Siang" | "Malam";

        // Finding #23: keep original item rows and update them in place instead
        // of delete + re-insert. incidents.checklistItemId (unique, FK
        // onDelete: set null) used to be severed on every edit by fresh item
        // ids — orphaning open incidents and never creating incidents for
        // newly NOT-OK devices. In-place updates keep incident links alive;
        // incident creation for newly NOT-OK devices dedupes on the unique
        // incidents.checklist_item_id, so re-edits never double-create.
        await db.transaction(async (tx) => {
            await tx.update(checklistEntries).set({
                checkDate,
                checkTime,
                shift,
            }).where(eq(checklistEntries.id, entryId));

            const oldItems = await tx.query.checklistItems.findMany({
                where: eq(checklistItems.entryId, entryId),
            });
            const oldByDevice = new Map(oldItems.map((item) => [item.deviceId, item]));

            const upserted: { itemId: number; deviceId: number; status: "OK" | "NOT OK"; remarks: string }[] = [];

            for (const deviceId of deviceIds) {
                const status = (formData.get(`status-${deviceId}`) as "OK" | "NOT OK") || "OK";
                const remarks = formData.get(`remarks-${deviceId}`) as string;
                const photoFile = formData.get(`photo-${deviceId}`) as File;
                const existingPhotoPath = formData.get(`existingPhoto-${deviceId}`) as string;

                let photoPath: string | null = existingPhotoPath || null;

                // Handle new file upload
                if (photoFile && photoFile.size > 0 && photoFile.name !== "undefined") {
                    photoPath = await saveUploadFile(
                        photoFile,
                        `${entryId}-${deviceId}`,
                        { kind: "photo", directory: "root" },
                    );

                    // Delete old photo if exists
                    if (existingPhotoPath) {
                        try {
                            await deleteUploadFile(existingPhotoPath);
                        } catch (e) {
                            console.error("Failed to delete old photo:", e);
                        }
                    }
                }

                // Handle photo deletion
                const deletePhoto = formData.get(`deletePhoto-${deviceId}`) === "on";
                if (deletePhoto && photoPath) {
                    try {
                        await deleteUploadFile(photoPath);
                    } catch (e) {
                        console.error("Failed to delete photo:", e);
                    }
                    photoPath = null;
                }

                const old = oldByDevice.get(deviceId);
                if (old) {
                    // In-place update: the row (and any incident linked to it)
                    // survives the edit.
                    await tx.update(checklistItems).set({
                        status,
                        remarks: remarks || "",
                        photoPath,
                    }).where(eq(checklistItems.id, old.id));
                    upserted.push({ itemId: old.id, deviceId, status, remarks: remarks || "" });
                } else {
                    const [item] = await tx.insert(checklistItems).values({
                        entryId,
                        deviceId,
                        status,
                        remarks: remarks || "",
                        photoPath,
                    }).onConflictDoNothing({ target: [checklistItems.entryId, checklistItems.deviceId] }).returning();
                    if (item) upserted.push({ itemId: item.id, deviceId, status, remarks: remarks || "" });
                }
            }

            // Devices that left the entry: drop the row (and its photo). The
            // incident FK goes NULL here as before, but a removal is an
            // explicit edit, not a delete/re-insert side effect — and we do
            // NOT auto-resolve its incident (removal says nothing about the
            // device's health).
            for (const old of oldItems) {
                if (deviceIds.includes(old.deviceId)) continue;
                if (old.photoPath) {
                    try {
                        await deleteUploadFile(old.photoPath);
                    } catch (e) {
                        console.error("Failed to delete photo:", e);
                    }
                }
                await tx.delete(checklistItems).where(eq(checklistItems.id, old.id));
            }

            // Reconcile incidents (finding #23):
            // 1. newly NOT-OK items → create incidents. Dedupes on the unique
            //    incidents.checklist_item_id, so NOT-OK items that already
            //    have an incident (still NOT-OK re-edit) stay single.
            const notOkItems = upserted.filter((item) => item.status === "NOT OK");
            await createIncidentsForChecklistItems({
                siteId: auth.activeSiteId,
                userId: session.userId,
                items: notOkItems.map((item) => ({
                    checklistItemId: item.itemId,
                    deviceId: item.deviceId,
                    status: item.status,
                    remarks: item.remarks || "No remarks provided",
                })),
            }, tx);

            // 2. Devices flipped NOT OK → OK: auto-resolve their still-open
            //    incidents. Verified/Resolved incidents are left untouched.
            const newStatusByDevice = new Map(upserted.map((item) => [item.deviceId, item.status]));
            const flippedToOk = oldItems.filter(
                (old) => old.status === "NOT OK" && newStatusByDevice.get(old.deviceId) === "OK",
            );
            if (flippedToOk.length > 0) {
                const openOnFlipped = await tx.select({ id: incidents.id, status: incidents.status }).from(incidents)
                    .where(and(
                        inArray(incidents.checklistItemId, flippedToOk.map((item) => item.id)),
                        or(eq(incidents.status, "Open"), eq(incidents.status, "In Progress")),
                    ));

                for (const incident of openOnFlipped) {
                    await tx.update(incidents).set({
                        status: "Resolved",
                        resolutionCategory: "False Alarm",
                        resolutionAction: "No Action Needed",
                        resolvedById: session.userId,
                        resolvedAt: new Date(),
                        updatedAt: new Date(),
                    }).where(eq(incidents.id, incident.id));

                    await tx.insert(incidentUpdates).values({
                        incidentId: incident.id,
                        authorId: session.userId,
                        updateType: "status_changed",
                        note: "Device OK in updated checklist entry — auto-resolved.",
                        previousStatus: incident.status,
                        newStatus: "Resolved",
                    });
                }
            }
        });

        await logAudit({
            action: "UPDATE",
            entity: "checklist",
            entityId: entryId,
            entityName: `${checkDate} ${shift}`,
            detail: `Checklist updated with ${deviceIds.length} items`,
        });

        revalidatePath("/checklist");
        revalidatePath("/report");
        return { success: true, message: "Checklist updated successfully" };

    } catch (error) {
        console.error("Update checklist error:", error);
        if (error instanceof UploadValidationError) return { message: error.message };
        return { message: "Failed to update checklist" };
    }
}

// Delete checklist entry
export async function deleteChecklistEntry(entryId: number) {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return { message: auth.message };
    const session = auth.session;

    // Verify ownership
    const entry = await db.query.checklistEntries.findFirst({
        where: and(eq(checklistEntries.id, entryId), eq(checklistEntries.siteId, auth.activeSiteId)),
    });

    const canAdminister = await hasAdminAccess();
    if (!entry || (entry.userId !== session.userId && !canAdminister)) {
        return { message: "Unauthorized" };
    }

    try {
        // Get all items with photos
        const items = await db.query.checklistItems.findMany({
            where: eq(checklistItems.entryId, entryId),
        });

        // Delete photo files
        for (const item of items) {
            if (item.photoPath) {
                try {
                    await deleteUploadFile(item.photoPath);
                } catch (e) {
                    console.error("Failed to delete photo:", e);
                }
            }
        }

        // Delete items (cascade will handle the rest, or we delete manually)
        await db.delete(checklistItems).where(eq(checklistItems.entryId, entryId));

        // Delete entry
        await db.delete(checklistEntries).where(eq(checklistEntries.id, entryId));

        await logAudit({
            action: "DELETE",
            entity: "checklist",
            entityId: entryId,
            entityName: `${entry.checkDate} ${entry.shift}`,
            detail: `Checklist entry deleted (${items.length} items, ${items.filter((i) => i.photoPath).length} photos)`,
        });

        revalidatePath("/checklist");
        revalidatePath("/report");
        return { success: true, message: "Checklist deleted successfully" };

    } catch (error) {
        console.error("Delete checklist error:", error);
        return { message: "Failed to delete checklist" };
    }
}

// Get recent checklists for report page
export async function getRecentChecklists(limit: number = 50) {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return [];

    const siteFilter = eq(checklistEntries.siteId, auth.activeSiteId);

    const checklists = await db.select({
        id: checklistEntries.id,
        checkDate: checklistEntries.checkDate,
        checkTime: checklistEntries.checkTime,
        shift: checklistEntries.shift,
        userName: users.username,
        itemCount: sql<number>`COUNT(${checklistItems.id})`,
        okCount: sql<number>`SUM(CASE WHEN ${checklistItems.status} = 'OK' THEN 1 ELSE 0 END)`,
        notOkCount: sql<number>`SUM(CASE WHEN ${checklistItems.status} = 'NOT OK' THEN 1 ELSE 0 END)`,
    })
        .from(checklistEntries)
        .leftJoin(users, eq(checklistEntries.userId, users.id))
        .leftJoin(checklistItems, eq(checklistEntries.id, checklistItems.entryId))
        .where(siteFilter)
        .groupBy(checklistEntries.id, users.username)
        .orderBy(desc(checklistEntries.checkDate), desc(checklistEntries.checkTime))
        .limit(limit);

    return checklists;
}
