
"use server";

import { db } from "../db";
import { checklistEntries, checklistItems, users, sites, devices } from "../db/schema";
import { sendTelegramAlert } from "@/lib/telegram";
import { verifySession } from "../lib/session";
import { revalidatePath } from "next/cache";
import fs from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

export async function submitChecklist(prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session) return { message: "Unauthorized" };

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
            siteId: session.activeSiteId,
            userId: session.userId,
            checkDate,
            checkTime,
            shift,
        }).returning();

        // 3. Process each device item
        const deviceIds = formData.getAll("deviceId");
        const alertItems: { deviceId: number; status: "Warning" | "Error"; remarks: string }[] = [];

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

            await db.insert(checklistItems).values({
                entryId: entry.id,
                deviceId,
                status: status || "OK",
                remarks: remarks || "",
                photoPath,
            });

            if (status === "Warning" || status === "Error") {
                alertItems.push({ deviceId, status, remarks: remarks || "No remarks provided" });
            }
        }

        // 5. Dispatch Telegram Alerts (if applicable)
        if (alertItems.length > 0 && session.activeSiteId) {
            try {
                const [site, user] = await Promise.all([
                    db.query.sites.findFirst({ where: eq(sites.id, session.activeSiteId) }),
                    db.query.users.findFirst({ where: eq(users.id, session.userId) })
                ]);

                if (site?.telegramChatId) {
                    const failedIds = alertItems.map(a => a.deviceId);
                    const devicesInfo = await db.query.devices.findMany({
                        where: inArray(devices.id, failedIds),
                        with: { location: true }
                    });

                    let message = `🚨 *Data Center Audit Alert* 🚨\n`;
                    message += `📍 *Site:* ${site.name}\n`;
                    message += `👤 *Auditor:* ${user?.username || 'Unknown'}\n`;
                    message += `⏰ *Time:* ${checkDate} ${checkTime}\n\n`;

                    for (const alert of alertItems) {
                        const dev = devicesInfo.find(d => d.id === alert.deviceId);
                        const devName = dev ? dev.name : `Device #${alert.deviceId}`;
                        const locName = dev?.location?.name ? `(${dev.location.name})` : '';
                        const icon = alert.status === "Error" ? "❌" : "⚠️";
                        message += `${icon} *${devName}* ${locName}\n`;
                        message += `   └ Status: ${alert.status}\n`;
                        message += `   └ Remarks: ${alert.remarks}\n\n`;
                    }

                    // Async dispatch so we don't block the UI response
                    sendTelegramAlert(site.telegramChatId, message).catch(console.error);
                }
            } catch (e) {
                console.error("Failed to dispatch telegram alerts:", e);
            }
        }

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
    const session = await verifySession();
    if (!session) return null;

    const entry = await db.query.checklistEntries.findFirst({
        where: eq(checklistEntries.id, entryId),
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
    if (entry.userId !== session.userId && !["admin", "superadmin"].includes(session.role)) {
        return null;
    }

    return entry;
}

// Update checklist entry
export async function updateChecklist(prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session) return { message: "Unauthorized" };

    const entryId = Number(formData.get("entryId"));
    if (!entryId) {
        return { message: "Invalid entry ID" };
    }

    // Verify ownership
    const entry = await db.query.checklistEntries.findFirst({
        where: eq(checklistEntries.id, entryId),
    });

    if (!entry || (entry.userId !== session.userId && !["admin", "superadmin"].includes(session.role))) {
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
    const session = await verifySession();
    if (!session) return { message: "Unauthorized" };

    // Verify ownership
    const entry = await db.query.checklistEntries.findFirst({
        where: eq(checklistEntries.id, entryId),
    });

    if (!entry || (entry.userId !== session.userId && !["admin", "superadmin"].includes(session.role))) {
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
