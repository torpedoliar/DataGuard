
"use server";

import { db } from "../db";
import { checklistEntries, checklistItems, users, sites, devices, siteTelegramChatIds, incidents, incidentUpdates, emailAlerts } from "../db/schema";
import { createIncidentsForChecklistItems } from "@/actions/incidents";
import { getTelegramAlertTemplate } from "@/actions/settings";
import { renderTelegramTemplate, sendTelegramAlert, splitTelegramChunks } from "@/lib/telegram";
import { resolveNotificationBaseUrl } from "@/lib/notification-url";
import { isEmailConfigured, renderEmailTemplate, resolveChecklistPicRecipients, sendChecklistPicEmail } from "@/lib/email";
import { getEmailAlertTemplate } from "@/actions/settings";
import { hasAdminAccess } from "../lib/site-access";
import { requireActiveSiteAction } from "../lib/action-auth";
import { logAudit } from "../lib/audit";
import { revalidatePath } from "next/cache";
import { deleteUploadFile, saveUploadFile, UploadValidationError, validateUpload } from "../lib/upload";
import { eq, and, or, desc, sql, inArray } from "drizzle-orm";

const SEVERITY_RANK = { Low: 1, Medium: 2, High: 3, Critical: 4 } as const;
type ChecklistSeverity = keyof typeof SEVERITY_RANK;

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
        const siteDevices = await db.select({ id: devices.id }).from(devices)
            .where(and(inArray(devices.id, deviceIds), eq(devices.siteId, auth.activeSiteId)));
        if (siteDevices.length !== deviceIds.length) {
            return { message: "Some devices are not valid for the active site. Reload the page and try again." };
        }

        // 2. Create entry + per-device items + incidents atomically (finding #08):
        //    a mid-loop failure rolls back the whole submit, and a retry is
        //    idempotent (unique (entry_id, device_id) index + onConflictDoNothing
        //    on items; incidents dedupe on the unique checklist_item_id).
        const alertItems: { checklistItemId: number; deviceId: number; status: "NOT OK"; remarks: string }[] = [];
        const incidentItems: {
            checklistItemId: number;
            deviceId: number;
            status: "NOT OK";
            remarks: string;
            photoPath: string | null;
        }[] = [];
        let entryId = 0;
        let createdIncidents: Awaited<ReturnType<typeof createIncidentsForChecklistItems>> = [];

        await db.transaction(async (tx) => {
            const [entry] = await tx.insert(checklistEntries).values({
                siteId: auth.activeSiteId,
                userId: session.userId,
                checkDate,
                checkTime,
                shift,
            }).returning();
            entryId = entry.id;

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
                        `${entry.id}-${deviceId}`,
                        { kind: "photo", directory: "root" },
                    );
                }

                const normalizedStatus = (status || "OK") as "OK" | "NOT OK";
                const [item] = await tx.insert(checklistItems).values({
                    entryId: entry.id,
                    deviceId,
                    status: normalizedStatus,
                    remarks: remarks || "",
                    photoPath,
                }).onConflictDoNothing({ target: [checklistItems.entryId, checklistItems.deviceId] }).returning();

                // Conflict = a concurrent duplicate insert of the same
                // entry+device already created the row: the first insert wins
                // and the alert/incident sub-flow must not run again for it.
                if (!item) continue;

                if (normalizedStatus === "NOT OK") {
                    alertItems.push({ checklistItemId: item.id, deviceId, status: normalizedStatus, remarks: remarks || "No remarks provided" });
                    incidentItems.push({
                        checklistItemId: item.id,
                        deviceId,
                        status: normalizedStatus,
                        remarks: remarks || "No remarks provided",
                        photoPath,
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
                    }
                }

                // PIC email alerts: each device group bound to a NOT-OK device
                // gets ONE email addressed to all of its owner users. Body is
                // rendered from the editable template (Settings, same {field}
                // syntax as Telegram) once per device, blocks joined with a
                // separator. Skipped entirely when SMTP is unset.
                if (isEmailConfigured() && site) {
                    try {
                        const picGroups = await resolveChecklistPicRecipients(failedIds, auth.activeSiteId);
                        const emailTemplate = await getEmailAlertTemplate();

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

                            const subject = `[DataGuard] ${deviceBlocks.length} device${deviceBlocks.length === 1 ? "" : "s"} NOT OK — ${site.code || site.name} — ${checkDate} ${shift}`;
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

                            // Fire-and-forget like Telegram; the history row is
                            // written once with a terminal status. recipient
                            // stores the group's full To line; recipientName
                            // the group name.
                            void sendChecklistPicEmail(group.emails, subject, htmlBody, textBody)
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
