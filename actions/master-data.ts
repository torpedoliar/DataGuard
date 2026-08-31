
"use server";

import { db } from "../db";
import {
    devices,
    categories,
    checklistItems,
    brands,
    locations,
    racks,
    incidents,
    networkPorts,
    syslogSources,
    syslogEvents,
    siemFindings,
    siemEvidenceEvents,
    devicePics,
    deviceGroups,
} from "../db/schema";
import { and, eq, or, isNull, sql, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifySession } from "../lib/session";
import { checkRackCollision, rackCapacityErrorMessage, rackPlacementExceedsCapacity } from "../lib/rack-validation";
import { logAudit } from "../lib/audit";
import { requireActiveSiteAction, requireActiveSiteAdminAction } from "../lib/action-auth";
import { deleteUploadFile, saveUploadFile } from "../lib/upload";

// Schemas
const deviceSchema = z.object({
    name: z.string().min(1, "Name is required"),
    assetCode: z.string().nullable().optional(),
    brandId: z.coerce.number().nullable().optional(),
    categoryId: z.coerce.number().min(1, "Category is required"),
    locationId: z.coerce.number().min(1, "Location is required"),
    zone: z.string().nullable().optional(),
    rackName: z.string().nullable().optional(),
    rackPosition: z.preprocess((val) => val === "" || val === null || val === undefined ? null : Number(val), z.number().nullable().optional()),
    // u_height is an INTEGER column: reject fractional heights (e.g. 0.5U from
    // an old/bulk payload) with a clear validation error instead of failing at
    // the Postgres integer column with a generic server error.
    uHeight: z.preprocess((val) => val === "" || val === null || val === undefined ? 1 : Number(val), z.number().int("U height harus bilangan bulat (mis. 1U, 2U).").default(1)),
    ipAddress: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
});

const categorySchema = z.object({
    name: z.string().min(1, "Name is required"),
    color: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid color Hex code").optional().default("#3b82f6"),
});

// Category Actions
export async function getCategories() {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return [];

    return await db.select().from(categories);
}

export async function addCategory(prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session || !(["admin", "superadmin"].includes(session.role))) return { message: "Anda tidak memiliki hak akses (Unauthorized)." };

    const parsed = categorySchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

    try {
        await db.insert(categories).values({
            name: parsed.data.name,
            color: parsed.data.color,
        });
        revalidatePath("/admin");
        revalidatePath("/admin/categories");
        await logAudit({ action: "CREATE", entity: "category", entityName: parsed.data.name, detail: `Color: ${parsed.data.color}` });
        return { success: true, message: "Category added successfully" };
    } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
            return { message: "Nama kategori sudah ada! Silakan gunakan nama yang berbeda." };
        }
        console.error("Add category error:", error);
        return { message: "Gagal menyimpan kategori karena kendala server. Silakan coba lagi." };
    }
}

export async function editCategory(id: number, prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session || !(["admin", "superadmin"].includes(session.role))) return { message: "Anda tidak memiliki hak akses (Unauthorized)." };

    const parsed = categorySchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

    try {
        await db.update(categories)
            .set({
                name: parsed.data.name,
                color: parsed.data.color,
            })
            .where(eq(categories.id, id));

        revalidatePath("/admin");
        revalidatePath("/admin/categories");
        revalidatePath("/admin/rack");
        await logAudit({ action: "UPDATE", entity: "category", entityId: id, entityName: parsed.data.name });
        return { success: true, message: "Category updated successfully" };
    } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
            return { message: "Kategori dengan nama tersebut sudah ada. Harap pilih nama lain." };
        }
        console.error("Edit category error:", error);
        return { message: "Gagal memperbarui kategori. Silakan coba beberapa saat lagi." };
    }
}

export async function deleteCategory(id: number) {
    const session = await verifySession();
    if (!session || !(["admin", "superadmin"].includes(session.role))) return { message: "Anda tidak memiliki hak akses (Unauthorized)." };

    try {
        // Check if category is used by any devices
        const devicesWithCategory = await db.query.devices.findMany({
            where: eq(devices.categoryId, id),
            columns: { id: true, name: true },
        });

        if (devicesWithCategory.length > 0) {
            return {
                message: "Kategori ini masih digunakan oleh perangkat server aktif! Anda tidak bisa menghapusnya secara langsung.",
                usageCount: devicesWithCategory.length,
                devices: devicesWithCategory.map(d => d.name),
            };
        }

        await db.delete(categories).where(eq(categories.id, id));
        revalidatePath("/admin");
        revalidatePath("/admin/categories");
        await logAudit({ action: "DELETE", entity: "category", entityId: id });
        return { success: true, message: "Category deleted successfully" };
    } catch (error) {
        console.error("Delete category error:", error);
        return { message: "Gagal menghapus kategori akibat gangguan server." };
    }
}

// Device Actions
export async function getDevices() {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return [];

    const rackFilter = or(eq(racks.isAuditable, true), isNull(racks.id));

    return await db
        .select({
            id: devices.id,
            name: devices.name,
            assetCode: devices.assetCode,
            brandId: devices.brandId,
            brandName: brands.name,
            brandLogo: brands.logoPath,
            locationId: devices.locationId,
            locationName: locations.name,
            categoryName: categories.name,
            categoryId: devices.categoryId,
            rackName: devices.rackName,
            rackPosition: devices.rackPosition,
            uHeight: devices.uHeight,
            zone: devices.zone,
            ipAddress: devices.ipAddress,
            description: devices.description,
            photoPath: devices.photoPath,
            isActive: devices.isActive,
        })
        .from(devices)
        .leftJoin(categories, eq(devices.categoryId, categories.id))
        .leftJoin(brands, eq(devices.brandId, brands.id))
        .leftJoin(locations, eq(devices.locationId, locations.id))
        .leftJoin(racks, and(eq(racks.siteId, devices.siteId), sql`lower(${racks.name}) = lower(${devices.rackName})`))
        .where(and(eq(devices.siteId, auth.activeSiteId), rackFilter));
}

export async function addDevice(prevState: unknown, formData: FormData) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { message: auth.message };

    const parsed = deviceSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

    let rackTotalU: number | null = null;
    if (parsed.data.rackName) {
        const targetRack = await db.query.racks.findFirst({
            // Case-insensitive name match: getRackLayout merges racks by
            // lowercased name, so capacity/collision checks must find the
            // rack regardless of casing (finding #33)
            where: and(sql`lower(${racks.name}) = lower(${parsed.data.rackName})`, eq(racks.siteId, auth.activeSiteId)),
            columns: { totalU: true },
        });
        rackTotalU = targetRack?.totalU ?? null;
    }

    if (parsed.data.rackName && parsed.data.rackPosition) {
        if (rackPlacementExceedsCapacity({ rackPosition: parsed.data.rackPosition, uHeight: parsed.data.uHeight, totalU: rackTotalU })) {
            return { message: rackCapacityErrorMessage(rackTotalU) };
        }

        const collisions = await checkRackCollision(
            auth.activeSiteId,
            parsed.data.rackName,
            parsed.data.rackPosition,
            parsed.data.uHeight || 1
        );
        if (collisions.length > 0) {
            return { message: `Collision detected: Overlaps with ${collisions.map(c => `${c.name} (U${c.rackPosition}${c.uHeight! > 1 ? `-U${c.rackPosition! + c.uHeight! - 1}` : ''})`).join(", ")}` };
        }
    }

    try {
        let photoPath: string | null = null;
        const photoFile = formData.get("photo") as File | null;
        if (photoFile && photoFile.size > 0 && photoFile.name !== "undefined") {
            photoPath = await saveUploadFile(
                photoFile,
                "device",
                { kind: "photo", directory: "devices" },
            );
        }

        await db.insert(devices).values({
            siteId: auth.activeSiteId,
            name: parsed.data.name,
            assetCode: parsed.data.assetCode || null,
            brandId: parsed.data.brandId || null,
            categoryId: parsed.data.categoryId,
            locationId: parsed.data.locationId,
            zone: parsed.data.zone || null,
            rackName: parsed.data.rackName || null,
            rackPosition: parsed.data.rackPosition || null,
            uHeight: parsed.data.uHeight || 1,
            ipAddress: parsed.data.ipAddress || null,
            description: parsed.data.description || null,
            photoPath,
        });
        revalidatePath("/admin");
        revalidatePath("/admin/rack");
        await logAudit({ action: "CREATE", entity: "device", entityName: parsed.data.name, detail: parsed.data.rackName ? `Rack: ${parsed.data.rackName} U${parsed.data.rackPosition}` : undefined });
        return { success: true, message: "Device added successfully" };
    } catch (error) {
        console.error("Add device error:", error);
        return { message: "Terjadi gangguan sistem saat menyimpan perangkat. Silakan coba lagi." };
    }
}

export async function updateDevice(prevState: unknown, formData: FormData) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { message: auth.message };

    const id = Number(formData.get("id"));
    if (!id) {
        return { message: "ID Perangkat tidak ditemukan / tidak valid." };
    }

    const parsed = deviceSchema.partial().safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

    try {
        const existingDevice = await db.query.devices.findFirst({
            where: and(eq(devices.id, id), eq(devices.siteId, auth.activeSiteId)),
        });
        if (!existingDevice) return { message: "Perangkat tidak ditemukan di site aktif." };

        let rackTotalU: number | null = null;
        if (parsed.data.rackName) {
            const targetRack = await db.query.racks.findFirst({
                // Case-insensitive name match (finding #33): see addDevice.
                where: and(sql`lower(${racks.name}) = lower(${parsed.data.rackName})`, eq(racks.siteId, auth.activeSiteId)),
                columns: { totalU: true },
            });
            rackTotalU = targetRack?.totalU ?? null;
        }

        if (parsed.data.rackName && parsed.data.rackPosition) {
            if (rackPlacementExceedsCapacity({ rackPosition: parsed.data.rackPosition, uHeight: parsed.data.uHeight ?? existingDevice.uHeight, totalU: rackTotalU })) {
                return { message: rackCapacityErrorMessage(rackTotalU) };
            }

            const collisions = await checkRackCollision(
                auth.activeSiteId,
                parsed.data.rackName,
                parsed.data.rackPosition,
                parsed.data.uHeight || 1,
                id
            );
            if (collisions.length > 0) {
                return { message: `Gagal dipindah! Posisi ini bertabrakan dengan: ${collisions.map(c => `${c.name} (U${c.rackPosition}${c.uHeight! > 1 ? `-U${c.rackPosition! + c.uHeight! - 1}` : ''})`).join(", ")}` };
            }
        }

        let photoPath: string | null = existingDevice.photoPath || null;
        const photoFile = formData.get("photo") as File | null;
        const deletePhoto = formData.get("deletePhoto") === "on";

        if (photoFile && photoFile.size > 0 && photoFile.name !== "undefined") {
            photoPath = await saveUploadFile(
                photoFile,
                "device",
                { kind: "photo", directory: "devices" },
            );

            // Remove old photo if exists
            if (existingDevice.photoPath) {
                try { await deleteUploadFile(existingDevice.photoPath); } catch (e) { }
            }
        } else if (deletePhoto && existingDevice.photoPath) {
            try { await deleteUploadFile(existingDevice.photoPath); } catch (e) { }
            photoPath = null;
        }

        await db.update(devices).set({
            name: parsed.data.name,
            assetCode: parsed.data.assetCode || null,
            brandId: parsed.data.brandId,
            categoryId: parsed.data.categoryId,
            locationId: parsed.data.locationId,
            zone: parsed.data.zone,
            rackName: parsed.data.rackName,
            rackPosition: parsed.data.rackPosition,
            uHeight: parsed.data.uHeight,
            ipAddress: parsed.data.ipAddress,
            description: parsed.data.description,
            photoPath,
        }).where(and(eq(devices.id, id), eq(devices.siteId, auth.activeSiteId)));

        // PIC group binding from the device side: the form submits one
        // groupId checkbox per selected group; re-sync device_pics for this
        // device. Groups are validated against the active site (a group id
        // from another site must never bind). Empty selection = unbind all.
        const groupIds = (formData.getAll("groupIds") as string[]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
        const validGroups = groupIds.length > 0
            ? await db.select({ id: deviceGroups.id }).from(deviceGroups)
                .where(and(inArray(deviceGroups.id, groupIds), eq(deviceGroups.siteId, auth.activeSiteId)))
            : [];
        await db.delete(devicePics).where(eq(devicePics.deviceId, id));
        if (validGroups.length > 0) {
            await db.insert(devicePics).values(
                validGroups.map((g) => ({ deviceId: id, groupId: g.id, siteId: auth.activeSiteId })),
            );
        }

        revalidatePath("/admin");
        revalidatePath("/admin/rack");
        revalidatePath("/admin/device-groups");
        await logAudit({
            action: "UPDATE",
            entity: "device",
            entityId: id,
            entityName: parsed.data.name,
            detail: `IP: ${parsed.data.ipAddress ?? '-'}, Rack: ${parsed.data.rackName ?? '-'}, PIC groups: ${validGroups.map((g) => g.id).join(",") || "none"}`,
        });
        return { success: true, message: "Device updated successfully" };
    } catch (error) {
        console.error("Update device error:", error);
        return { message: "Gagal menyimpan perubahan. Silakan coba lagi." };
    }
}

// ---- Device deletion (history-preserving) ----
//
// Every column below references devices.id. All are NO ACTION FKs (or, for
// syslog_events, an FK dropped by the 0016 partition migration) whose rows are
// audit history — they MUST block hard deletion and must never be deleted to
// satisfy the FK. device_pics is the single ON DELETE CASCADE reference and is
// therefore informational only, never a blocker.

export type DeviceUsageDependency = {
    /** checklist_items.device_id — NO ACTION; audit history, blocks deletion. */
    checklistItems: number;
    /** incidents.device_id — NO ACTION; blocks deletion. */
    incidents: number;
    /** network_ports.device_id — NO ACTION; ports of this device, blocks deletion. */
    networkPorts: number;
    /** network_ports.connected_to_device_id — NO ACTION; ports of OTHER devices linked to this device. */
    linkedNetworkPorts: number;
    /** syslog_sources.device_id — NO ACTION; source config/history, blocks deletion. */
    syslogSources: number;
    /** syslog_events.device_id — FK dropped by migration 0016; events must be preserved. */
    syslogEvents: number;
    /** siem_findings.device_id — NO ACTION; findings must be preserved. */
    siemFindings: number;
    /** siem_evidence_events.device_id — NO ACTION; evidence snapshots must be preserved. */
    siemEvidenceEvents: number;
    /** device_pics.device_id — ON DELETE CASCADE; removed with the device, NOT a blocker. */
    devicePics: number;
};

export type ChecklistEntryPreview = {
    date: string;
    time: string;
    user: string;
};

export type DeviceDeletionUsageInfo = {
    success: true;
    deviceId: number;
    deviceName: string;
    canDelete: boolean;
    blockingCount: number;
    dependencies: DeviceUsageDependency;
    checklistPreview: ChecklistEntryPreview[];
    message: string;
};

export type DeviceDeletionUsageResult = DeviceDeletionUsageInfo | { success: false; message: string };

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type UsageSource = typeof db | DbTx;

function sumBlockingDeviceDependencies(dependencies: DeviceUsageDependency): number {
    return dependencies.checklistItems
        + dependencies.incidents
        + dependencies.networkPorts
        + dependencies.linkedNetworkPorts
        + dependencies.syslogSources
        + dependencies.syslogEvents
        + dependencies.siemFindings
        + dependencies.siemEvidenceEvents;
}

async function collectDeviceUsage(source: UsageSource, id: number): Promise<DeviceUsageDependency> {
    const [
        checklistItemsCount,
        incidentsCount,
        networkPortsCount,
        linkedNetworkPortsCount,
        syslogSourcesCount,
        syslogEventsCount,
        siemFindingsCount,
        siemEvidenceEventsCount,
        devicePicsCount,
    ] = await Promise.all([
        source.$count(checklistItems, eq(checklistItems.deviceId, id)),
        source.$count(incidents, eq(incidents.deviceId, id)),
        source.$count(networkPorts, eq(networkPorts.deviceId, id)),
        source.$count(networkPorts, eq(networkPorts.connectedToDeviceId, id)),
        source.$count(syslogSources, eq(syslogSources.deviceId, id)),
        source.$count(syslogEvents, eq(syslogEvents.deviceId, id)),
        source.$count(siemFindings, eq(siemFindings.deviceId, id)),
        source.$count(siemEvidenceEvents, eq(siemEvidenceEvents.deviceId, id)),
        source.$count(devicePics, eq(devicePics.deviceId, id)),
    ]);
    return {
        checklistItems: checklistItemsCount,
        incidents: incidentsCount,
        networkPorts: networkPortsCount,
        linkedNetworkPorts: linkedNetworkPortsCount,
        syslogSources: syslogSourcesCount,
        syslogEvents: syslogEventsCount,
        siemFindings: siemFindingsCount,
        siemEvidenceEvents: siemEvidenceEventsCount,
        devicePics: devicePicsCount,
    };
}

async function loadChecklistPreview(id: number): Promise<ChecklistEntryPreview[]> {
    const items = await db.query.checklistItems.findMany({
        where: eq(checklistItems.deviceId, id),
        columns: { id: true },
        with: {
            entry: {
                with: {
                    user: true,
                },
            },
        },
        limit: 10,
    });
    return items.map(item => ({
        date: item.entry.checkDate,
        time: item.entry.checkTime,
        user: item.entry.user.username,
    }));
}

/**
 * Read-only preflight for device deletion. Reports every reference to the
 * device (and a checklist history preview) without ever mutating anything.
 */
export async function getDeviceDeletionUsage(id: number): Promise<DeviceDeletionUsageResult> {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return { success: false, message: auth.message };

    const device = await db.query.devices.findFirst({
        where: and(eq(devices.id, id), eq(devices.siteId, auth.activeSiteId)),
        columns: { id: true, name: true },
    });
    if (!device) return { success: false, message: "Perangkat tidak ditemukan di site aktif." };

    const dependencies = await collectDeviceUsage(db, id);
    const blockingCount = sumBlockingDeviceDependencies(dependencies);
    const checklistPreview = dependencies.checklistItems > 0 ? await loadChecklistPreview(id) : [];

    if (blockingCount === 0) {
        return {
            success: true,
            deviceId: device.id,
            deviceName: device.name,
            canDelete: true,
            blockingCount: 0,
            dependencies,
            checklistPreview,
            message: "Perangkat tidak memiliki data terkait dan dapat dihapus.",
        };
    }

    return {
        success: true,
        deviceId: device.id,
        deviceName: device.name,
        canDelete: false,
        blockingCount,
        dependencies,
        checklistPreview,
        message: `Perangkat ini tidak dapat dihapus karena masih direferensikan oleh ${blockingCount} data terkait (riwayat checklist, insiden, port, syslog/SIEM). Nonaktifkan perangkat melalui toggle status untuk decommission.`,
    };
}

type DeleteDeviceTxOutcome =
    | { kind: "missing" }
    | { kind: "blocked"; blockingCount: number }
    | { kind: "deleted"; photoPath: string | null; deviceName: string };

/**
 * Hard-deletes a device, but ONLY when nothing references it. Related data
 * (checklist history, incidents, ports, syslog/SIEM records, evidence) is
 * never deleted — devices with any reference must be decommissioned via
 * `toggleDeviceStatus` instead.
 *
 * The delete runs inside a transaction: the device is re-read with the
 * active-site scope and every dependency is re-checked inside the tx, then
 * only the device row is deleted (device_pics cascades via its FK). The
 * database FK is the final race guard: if a reference appears between the
 * count and the DELETE, the NO ACTION FK aborts the transaction and nothing
 * is mutated. Upload files are removed only AFTER the commit succeeds, and
 * cache revalidation/audit logging also run after commit — never as part of
 * the rollback path.
 */
export async function deleteDevice(id: number, reason?: string) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { message: auth.message };

    try {
        const outcome = await db.transaction(async (tx): Promise<DeleteDeviceTxOutcome> => {
            // Re-read inside the transaction: state may have changed since the preflight.
            const device = await tx.query.devices.findFirst({
                where: and(eq(devices.id, id), eq(devices.siteId, auth.activeSiteId)),
                columns: { id: true, name: true, photoPath: true },
            });
            if (!device) return { kind: "missing" };

            const dependencies = await collectDeviceUsage(tx, id);
            const blockingCount = sumBlockingDeviceDependencies(dependencies);
            if (blockingCount > 0) return { kind: "blocked", blockingCount };

            await tx.delete(devices).where(and(eq(devices.id, id), eq(devices.siteId, auth.activeSiteId)));
            return { kind: "deleted", photoPath: device.photoPath, deviceName: device.name };
        });

        if (outcome.kind === "missing") return { message: "Perangkat tidak ditemukan di site aktif." };
        if (outcome.kind === "blocked") {
            return {
                message: `Perangkat ini tidak dapat dihapus karena masih direferensikan oleh ${outcome.blockingCount} data terkait. Data riwayat tidak dapat dihapus; nonaktifkan perangkat melalui toggle status untuk decommission.`,
                blockingCount: outcome.blockingCount,
            };
        }

        // The transaction committed — the device row is gone. Only now is it
        // safe to remove its upload photo (the filesystem is not transactional;
        // an orphan file is safer than a deleted photo of a still-existing device).
        if (outcome.photoPath) {
            try { await deleteUploadFile(outcome.photoPath); } catch (e) { }
        }
        revalidatePath("/admin");
        revalidatePath("/admin/rack");
        revalidatePath("/admin/rack-manage");
        await logAudit({ action: "DELETE", entity: "device", entityId: id, entityName: outcome.deviceName, detail: reason ? `Reason: ${reason}` : undefined });
        return { success: true };
    } catch (error) {
        if (error instanceof Error && /foreign key constraint/i.test(error.message)) {
            // A reference appeared between the in-transaction count and the DELETE.
            console.error("Delete device blocked by FK race:", error);
            return { message: "Perangkat tidak dapat dihapus: data terkait baru muncul saat penghapusan. Periksa kembali pemakaian perangkat." };
        }
        console.error("Delete device error:", error);
        return { message: "Terjadi kesalahan fatal saat menghapus perangkat. Coba lagi perlahan." };
    }
}

// Toggle device active/inactive status
export async function toggleDeviceStatus(deviceId: number) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { success: false, message: auth.message };

    const [device] = await db.select({ isActive: devices.isActive })
        .from(devices)
        .where(and(eq(devices.id, deviceId), eq(devices.siteId, auth.activeSiteId)));
    if (!device) return { success: false, message: "Device not found" };

    const newStatus = !device.isActive;
    await db.update(devices)
        .set({ isActive: newStatus })
        .where(and(eq(devices.id, deviceId), eq(devices.siteId, auth.activeSiteId)));

    revalidatePath("/admin");
    return { success: true, isActive: newStatus, message: `Device ${newStatus ? "activated" : "deactivated"} successfully.` };
}

// Take out device from rack (clear rack position)
export async function takeoutFromRack(deviceId: number) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { success: false, message: auth.message };

    const [device] = await db.select({ isActive: devices.isActive, rackName: devices.rackName })
        .from(devices)
        .where(and(eq(devices.id, deviceId), eq(devices.siteId, auth.activeSiteId)));
    if (!device) return { success: false, message: "Device not found" };
    if (device.isActive) return { success: false, message: "Device must be deactivated before taking out from rack." };
    if (!device.rackName) return { success: false, message: "Device is not in any rack." };

    await db.update(devices)
        .set({ rackName: null, rackPosition: null, uHeight: null, zone: null })
        .where(and(eq(devices.id, deviceId), eq(devices.siteId, auth.activeSiteId)));

    revalidatePath("/admin");
    revalidatePath("/admin/rack");
    return { success: true, message: "Device taken out from rack successfully." };
}
