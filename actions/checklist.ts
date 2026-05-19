
"use server";

import { db } from "../db";
import { checklistEntries, checklistItems, users, sites, devices } from "../db/schema";
import { createIncidentsForChecklistItems } from "@/actions/incidents";
import { getTelegramAlertTemplate } from "@/actions/settings";
import { renderTelegramTemplate, sendTelegramAlert } from "@/lib/telegram";
import { verifySession } from "../lib/session";
import { hasAdminAccess } from "../lib/site-access";
import { requireActiveSiteAction } from "../lib/action-auth";
import { revalidatePath } from "next/cache";
import fs from "node:fs/promises";
import path from "node:path";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

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

        // 2. Create Checklist Entry
        const [entry] = await db.insert(checklistEntries).values({
            siteId: auth.activeSiteId,
            userId: session.userId,
            checkDate,
            checkTime,
            shift,
        }).returning();

        // 3. Process each device item
        const deviceIds = formData.getAll("deviceId");
        const alertItems: { checklistItemId: number; deviceId: number; status: "Warning" | "Error"; remarks: string }[] = [];
        const incidentItems: {
            checklistItemId: number;
            deviceId: number;
            status: "Warning" | "Error";
            remarks: string;
            photoPath: string | null;
        }[] = [];

        for (const idStr of deviceIds) {
            const deviceId = parseInt(idStr as string);
            const status = formData.get(`status-${deviceId}`) as "OK" | "Warning" | "Error";
            const remarks = formData.get(`remarks-${deviceId}`) as string;
            const photoFile = formData.get(`photo-${deviceId}`) as File;

            let photoPath = null;

            // 4. Handle File Upload if exists
            if (photoFile && photoFile.size > 0 && photoFile.name !== "undefined") {
                const buffer = Buffer.from(await photoFile.arrayBuffer());
                const timestamp = Date.now();
                const safeName = photoFile.name.replace(/[^a-zA-Z0-9.-]/g, "_");
                const fileName = `${entry.id}-${deviceId}-${timestamp}-${safeName}`;
                const uploadDir = path.join(process.cwd(), "public/uploads");

                await fs.writeFile(path.join(uploadDir, fileName), buffer);
                photoPath = `/uploads/${fileName}`;
            }

            const normalizedStatus = (status || "OK") as "OK" | "Warning" | "Error";
            const [item] = await db.insert(checklistItems).values({
                entryId: entry.id,
                deviceId,
                status: normalizedStatus,
                remarks: remarks || "",
                photoPath,
            }).returning();

            if (normalizedStatus === "Warning" || normalizedStatus === "Error") {
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

        const createdIncidents = await createIncidentsForChecklistItems({
            siteId: auth.activeSiteId,
            userId: session.userId,
            items: incidentItems,
        });

        // 5. Dispatch Telegram Alerts (if applicable)
        if (alertItems.length > 0) {
            try {
                const [site, user, telegramTemplate] = await Promise.all([
                    db.query.sites.findFirst({ where: eq(sites.id, auth.activeSiteId) }),
                    db.query.users.findFirst({ where: eq(users.id, session.userId) }),
                    getTelegramAlertTemplate(),
                ]);

                if (site?.telegramChatId) {
                    const failedIds = alertItems.map(a => a.deviceId);
                    const devicesInfo = await db.query.devices.findMany({
                        where: inArray(devices.id, failedIds),
                        with: { brand: true, category: true, location: true }
                    });
                    const incidentByChecklistItemId = new Map(
                        createdIncidents.map((incident) => [incident.checklistItemId, incident]),
                    );

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
                        });
                    });
                    const message = messages.join("\n\n---\n\n");

                    // Async dispatch so we don't block the UI response
                    sendTelegramAlert(site.telegramChatId, message).catch(console.error);
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
        const deviceIds = formData.getAll("deviceId");

        // Delete existing items for this entry
        await db.delete(checklistItems).where(eq(checklistItems.entryId, entryId));

        // Re-insert items
        for (const idStr of deviceIds) {
            const deviceId = parseInt(idStr as string);
            const status = formData.get(`status-${deviceId}`) as "OK" | "Warning" | "Error";
            const remarks = formData.get(`remarks-${deviceId}`) as string;
            const photoFile = formData.get(`photo-${deviceId}`) as File;
            const existingPhotoPath = formData.get(`existingPhoto-${deviceId}`) as string;

            let photoPath: string | null = existingPhotoPath || null;

            // Handle new file upload
            if (photoFile && photoFile.size > 0 && photoFile.name !== "undefined") {
                const buffer = Buffer.from(await photoFile.arrayBuffer());
                const timestamp = Date.now();
                const safeName = photoFile.name.replace(/[^a-zA-Z0-9.-]/g, "_");
                const fileName = `${entryId}-${deviceId}-${timestamp}-${safeName}`;
                const uploadDir = path.join(process.cwd(), "public/uploads");

                await fs.writeFile(path.join(uploadDir, fileName), buffer);
                photoPath = `/uploads/${fileName}`;

                // Delete old photo if exists
                if (existingPhotoPath) {
                    try {
                        const oldPath = path.join(process.cwd(), "public", existingPhotoPath);
                        await fs.unlink(oldPath);
                    } catch (e) {
                        console.error("Failed to delete old photo:", e);
                    }
                }
            }

            // Handle photo deletion
            const deletePhoto = formData.get(`deletePhoto-${deviceId}`) === "on";
            if (deletePhoto && photoPath) {
                try {
                    const oldPath = path.join(process.cwd(), "public", photoPath);
                    await fs.unlink(oldPath);
                } catch (e) {
                    console.error("Failed to delete photo:", e);
                }
                photoPath = null;
            }

            await db.insert(checklistItems).values({
                entryId,
                deviceId,
                status: (status || "OK") as "OK" | "Warning" | "Error",
                remarks: remarks || "",
                photoPath,
            });
        }

        revalidatePath("/checklist");
        revalidatePath("/report");
        return { success: true, message: "Checklist updated successfully" };

    } catch (error) {
        console.error("Update checklist error:", error);
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
                    const photoPath = path.join(process.cwd(), "public", item.photoPath);
                    await fs.unlink(photoPath);
                } catch (e) {
                    console.error("Failed to delete photo:", e);
                }
            }
        }

        // Delete items (cascade will handle the rest, or we delete manually)
        await db.delete(checklistItems).where(eq(checklistItems.entryId, entryId));

        // Delete entry
        await db.delete(checklistEntries).where(eq(checklistEntries.id, entryId));

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
    const session = await verifySession();
    if (!session) return [];

    const siteFilter = session.activeSiteId ? eq(checklistEntries.siteId, session.activeSiteId) : undefined;

    const checklists = await db.select({
        id: checklistEntries.id,
        checkDate: checklistEntries.checkDate,
        checkTime: checklistEntries.checkTime,
        shift: checklistEntries.shift,
        userName: users.username,
        itemCount: sql<number>`COUNT(${checklistItems.id})`,
        okCount: sql<number>`SUM(CASE WHEN ${checklistItems.status} = 'OK' THEN 1 ELSE 0 END)`,
        warningCount: sql<number>`SUM(CASE WHEN ${checklistItems.status} = 'Warning' THEN 1 ELSE 0 END)`,
        errorCount: sql<number>`SUM(CASE WHEN ${checklistItems.status} = 'Error' THEN 1 ELSE 0 END)`,
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
