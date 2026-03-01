"use server";

import { db } from "../db";
import { racks, locations } from "../db/schema";
import { eq, asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifySession } from "../lib/session";
import { logAudit } from "../lib/audit";

// Schema
const rackSchema = z.object({
    name: z.string().min(1, "Rack name is required"),
    zone: z.string().optional(),
    totalU: z.coerce.number().min(1).max(60).default(42),
    locationId: z.coerce.number().optional(),
});

// Get all racks (filtered by active site)
export async function getRacks() {
    const session = await verifySession();
    const siteFilter = session?.activeSiteId ? eq(racks.siteId, session.activeSiteId) : undefined;
    return await db.select({
        id: racks.id,
        siteId: racks.siteId,
        name: racks.name,
        zone: racks.zone,
        totalU: racks.totalU,
        locationId: racks.locationId,
        locationName: locations.name,
        createdAt: racks.createdAt,
    })
        .from(racks)
        .leftJoin(locations, eq(racks.locationId, locations.id))
        .where(siteFilter).orderBy(asc(racks.name));
}

// Get occupied slots for a specific rack
export async function getOccupiedSlots(rackName: string, excludeDeviceId?: number) {
    const session = await verifySession();
    if (!session) return {};

    const { devices } = await import("../db/schema");
    const { eq, and, isNotNull, ne } = await import("drizzle-orm");

    const conditions = [
        eq(devices.rackName, rackName),
        isNotNull(devices.rackPosition)
    ];

    if (excludeDeviceId) {
        conditions.push(ne(devices.id, excludeDeviceId));
    }

    const rackDevices = await db.query.devices.findMany({
        where: and(...conditions),
        columns: {
            name: true,
            rackPosition: true,
            uHeight: true,
        }
    });

    const occupiedInfo: Record<number, string> = {};
    for (const device of rackDevices) {
        if (!device.rackPosition) continue;
        const uHeight = device.uHeight || 1;
        for (let i = 0; i < uHeight; i++) {
            occupiedInfo[device.rackPosition + i] = device.name;
        }
    }

    return occupiedInfo;
}

// Get single rack
export async function getRackById(id: number) {
    const session = await verifySession();
    if (!session) return null;

    return await db.query.racks.findFirst({
        where: eq(racks.id, id),
    });
}

// Add rack
export async function addRack(prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session || !(["admin", "superadmin"].includes(session.role))) {
        return { message: "Anda tidak memiliki hak akses (Unauthorized)." };
    }

    const parsed = rackSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
        return { errors: parsed.error.flatten().fieldErrors };
    }

    try {
        await db.insert(racks).values({
            siteId: session.activeSiteId,
            name: parsed.data.name,
            zone: parsed.data.zone || null,
            totalU: parsed.data.totalU || 42,
            locationId: parsed.data.locationId || null,
        });

        revalidatePath("/admin/rack-manage");
        revalidatePath("/admin/rack");
        await logAudit({ action: "CREATE", entity: "rack", entityName: parsed.data.name, detail: `Zone: ${parsed.data.zone || '-'}, U: ${parsed.data.totalU}` });
        return { success: true, message: "Rack added successfully" };
    } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
            return { message: "Nama rak ini sudah terdaftar. Silakan gunakan nama lain." };
        }
        return { message: "Terjadi kesalahan saat menyimpan rak baru." };
    }
}

// Update rack
export async function updateRack(prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session || !(["admin", "superadmin"].includes(session.role))) {
        return { message: "Anda tidak memiliki hak akses (Unauthorized)." };
    }

    const id = Number(formData.get("id"));
    if (!id) {
        return { message: "ID Rak tidak valid atau tidak ditemukan." };
    }

    const parsed = rackSchema.partial().safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
        return { errors: parsed.error.flatten().fieldErrors };
    }

    try {
        await db.update(racks).set({
            name: parsed.data.name,
            zone: parsed.data.zone,
            totalU: parsed.data.totalU,
            locationId: parsed.data.locationId,
        }).where(eq(racks.id, id));

        revalidatePath("/admin/rack-manage");
        revalidatePath("/admin/rack");
        await logAudit({ action: "UPDATE", entity: "rack", entityId: id, entityName: parsed.data.name, detail: `U: ${parsed.data.totalU}` });
        return { success: true, message: "Rack updated successfully" };
    } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
            return { message: "Nama rak ini sudah terdaftar. Silakan gunakan nama lain." };
        }
        return { message: "Terjadi kesalahan saat memperbarui konfigurasi rak." };
    }
}

// Delete rack
export async function deleteRack(id: number) {
    const session = await verifySession();
    if (!session || !(["admin", "superadmin"].includes(session.role))) {
        return { message: "Anda tidak memiliki hak akses (Unauthorized)." };
    }

    try {
        await db.delete(racks).where(eq(racks.id, id));

        revalidatePath("/admin/rack-manage");
        revalidatePath("/admin/rack");
        await logAudit({ action: "DELETE", entity: "rack", entityId: id });
        return { success: true };
    } catch (error) {
        return { message: "Gagal menghapus rak ini karena mungkin masih berisi perangkat server aktif." };
    }
}
