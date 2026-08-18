
"use server";

import { db } from "../db";
import { checklistEntries, checklistItems, users, sites, devices, siteTelegramChatIds } from "../db/schema";
import { createIncidentsForChecklistItems } from "@/actions/incidents";
import { getTelegramAlertTemplate } from "@/actions/settings";
import { renderTelegramTemplate, sendTelegramAlert } from "@/lib/telegram";
import { resolveNotificationBaseUrl } from "@/lib/notification-url";
import { hasAdminAccess } from "../lib/site-access";
import { requireActiveSiteAction } from "../lib/action-auth";
import { logAudit } from "../lib/audit";
import { revalidatePath } from "next/cache";
import { deleteUploadFile, saveUploadFile, UploadValidationError, validateUpload } from "../lib/upload";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

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
                    // Map the worst item severity to a single severity bucket
                    // for filter purposes. Critical > High > Medium > Low.
                    alertItems.some((a) => a.status === "NOT OK")
                        ? "Medium"
                        : "Low",
                    site?.telegramChatId,
                );

                if (site && recipients.length > 0) {
                    const failedIds = alertItems.map(a => a.deviceId);
                    const devicesInfo = await db.query.devices.findMany({
                        where: inArray(devices.id, failedIds),
                        with: { brand: true, category: true, location: true }
                    });
                    const incidentByChecklistItemId = new Map(
                        createdIncidents.map((incident) => [incident.checklistItemId, incident]),
                    );
                    const baseUrl = await resolveNotificationBaseUrl();

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
                    const message = messages.join("\n\n---\n\n");

                    // Async dispatch so we don't block the UI response
                    for (const recipient of recipients) {
                        sendTelegramAlert(recipient.chatId, message).catch(console.error);
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

        // Update entry
        await db.update(checklistEntries).set({
            checkDate,
            checkTime,
            shift,
        }).where(eq(checklistEntries.id, entryId));

        // Get all device IDs from the form

        // Delete existing items for this entry
        await db.delete(checklistItems).where(eq(checklistItems.entryId, entryId));

        // Re-insert items
        for (const idStr of deviceIds) {
            const deviceId = parseInt(idStr as string);
            const status = formData.get(`status-${deviceId}`) as "OK" | "NOT OK";
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

            await db.insert(checklistItems).values({
                entryId,
                deviceId,
                status: (status || "OK") as "OK" | "NOT OK",
                remarks: remarks || "",
                photoPath,
            });
        }

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
