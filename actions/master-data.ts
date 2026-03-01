
"use server";

import { db } from "../db";
import { devices, categories, checklistItems, brands, locations } from "../db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifySession } from "../lib/session";
import { checkRackCollision } from "../lib/rack-validation";
import { logAudit } from "../lib/audit";
import fs from "node:fs/promises";
import path from "node:path";

// Schemas
const deviceSchema = z.object({
    name: z.string().min(1, "Name is required"),
    brandId: z.coerce.number().nullable().optional(),
    categoryId: z.coerce.number().min(1, "Category is required"),
    locationId: z.coerce.number().min(1, "Location is required"),
    zone: z.string().nullable().optional(),
    rackName: z.string().nullable().optional(),
    rackPosition: z.preprocess((val) => val === "" || val === null || val === undefined ? null : Number(val), z.number().nullable().optional()),
    uHeight: z.preprocess((val) => val === "" || val === null || val === undefined ? 1 : Number(val), z.number().default(1)),
    ipAddress: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
});

const categorySchema = z.object({
    name: z.string().min(1, "Name is required"),
    color: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid color Hex code").optional().default("#3b82f6"),
});

// Category Actions
export async function getCategories() {
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
    const session = await verifySession();
    const siteFilter = session?.activeSiteId ? eq(devices.siteId, session.activeSiteId) : undefined;

    return await db
        .select({
            id: devices.id,
            name: devices.name,
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
        .where(siteFilter);
}

export async function addDevice(prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session || !(["admin", "superadmin"].includes(session.role))) return { message: "Anda tidak memiliki hak akses (Unauthorized)." };

    const parsed = deviceSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

    if (parsed.data.rackName && parsed.data.rackPosition) {
        const collisions = await checkRackCollision(
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
            const buffer = Buffer.from(await photoFile.arrayBuffer());
            const timestamp = Date.now();
            const safeName = photoFile.name.replace(/[^a-zA-Z0-9.-]/g, "_");
            const fileName = `device-${timestamp}-${safeName}`;
            const uploadDir = path.join(process.cwd(), "public/uploads/devices");

            try { await fs.mkdir(uploadDir, { recursive: true }); } catch (e) { }
            await fs.writeFile(path.join(uploadDir, fileName), buffer);
            photoPath = `/uploads/devices/${fileName}`;
        }

        await db.insert(devices).values({
            siteId: session.activeSiteId,
            name: parsed.data.name,
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
    const session = await verifySession();
    if (!session || !(["admin", "superadmin"].includes(session.role))) return { message: "Anda tidak memiliki hak akses (Unauthorized)." };

    const id = Number(formData.get("id"));
    if (!id) {
        return { message: "ID Perangkat tidak ditemukan / tidak valid." };
    }

    const parsed = deviceSchema.partial().safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

    if (parsed.data.rackName && parsed.data.rackPosition) {
        const collisions = await checkRackCollision(
            parsed.data.rackName,
            parsed.data.rackPosition,
            parsed.data.uHeight || 1,
            id
        );
        if (collisions.length > 0) {
            return { message: `Gagal dipindah! Posisi ini bertabrakan dengan: ${collisions.map(c => `${c.name} (U${c.rackPosition}${c.uHeight! > 1 ? `-U${c.rackPosition! + c.uHeight! - 1}` : ''})`).join(", ")}` };
        }
    }

    try {
        const existingDevice = await db.query.devices.findFirst({ where: eq(devices.id, id) });
        if (!existingDevice) return { message: "Perangkat tidak ditemukan." };

        let photoPath: string | null = existingDevice.photoPath || null;
        const photoFile = formData.get("photo") as File | null;
        const deletePhoto = formData.get("deletePhoto") === "on";

        if (photoFile && photoFile.size > 0 && photoFile.name !== "undefined") {
            const buffer = Buffer.from(await photoFile.arrayBuffer());
            const timestamp = Date.now();
            const safeName = photoFile.name.replace(/[^a-zA-Z0-9.-]/g, "_");
            const fileName = `device-${timestamp}-${safeName}`;
            const uploadDir = path.join(process.cwd(), "public/uploads/devices");

            try { await fs.mkdir(uploadDir, { recursive: true }); } catch (e) { }
            await fs.writeFile(path.join(uploadDir, fileName), buffer);
            photoPath = `/uploads/devices/${fileName}`;

            // Remove old photo if exists
            if (existingDevice.photoPath) {
                try { await fs.unlink(path.join(process.cwd(), "public", existingDevice.photoPath)); } catch (e) { }
            }
        } else if (deletePhoto && existingDevice.photoPath) {
            try { await fs.unlink(path.join(process.cwd(), "public", existingDevice.photoPath)); } catch (e) { }
            photoPath = null;
        }

        await db.update(devices).set({
            name: parsed.data.name,
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
        }).where(eq(devices.id, id));

        revalidatePath("/admin");
        revalidatePath("/admin/rack");
        await logAudit({ action: "UPDATE", entity: "device", entityId: id, entityName: parsed.data.name, detail: `IP: ${parsed.data.ipAddress ?? '-'}, Rack: ${parsed.data.rackName ?? '-'}` });
        return { success: true, message: "Device updated successfully" };
    } catch (error) {
        console.error("Update device error:", error);
        return { message: "Gagal menyimpan perubahan. Silakan coba lagi." };
    }
}

export async function deleteDevice(id: number, reason?: string, forceDelete: boolean = false) {
    const session = await verifySession();
    if (!session || !(["admin", "superadmin"].includes(session.role))) return { message: "Anda tidak memiliki hak akses (Unauthorized)." };

    console.log(`Deleting device ${id}. Reason: ${reason || "Not provided"}. Force: ${forceDelete}`);

    try {
        // Check if device is used in checklist items
        const items = await db.query.checklistItems.findMany({
            where: eq(checklistItems.deviceId, id),
            with: {
                entry: {
                    with: {
                        user: true,
                    },
                },
            },
        });

        if (items.length > 0 && !forceDelete) {
            return {
                message: "Perangkat ini tidak bisa dihapus karena masih tercatat di riwayat Checklist / Audit! Gunakan fitur Hapus Paksa jika benar-benar perlu.",
                usageCount: items.length,
                entries: items.map(item => ({
                    date: item.entry.checkDate,
                    time: item.entry.checkTime,
                    user: item.entry.user.username,
                })),
            };
        }

        // If force delete, first delete related checklist items
        if (forceDelete && items.length > 0) {
            await db.delete(checklistItems).where(eq(checklistItems.deviceId, id));
        }

        const device = await db.query.devices.findFirst({ where: eq(devices.id, id) });
        if (device?.photoPath) {
            try { await fs.unlink(path.join(process.cwd(), "public", device.photoPath)); } catch (e) { }
        }

        await db.delete(devices).where(eq(devices.id, id));
        revalidatePath("/admin");
        revalidatePath("/admin/rack");
        revalidatePath("/admin/rack-manage");
        await logAudit({ action: "DELETE", entity: "device", entityId: id, entityName: device?.name, detail: reason ? `Reason: ${reason}` : undefined });
        return { success: true };
    } catch (error) {
        console.error("Delete device error:", error);
        return { message: "Terjadi kesalahan fatal saat menghapus perangkat. Coba lagi perlahan." };
    }
}

// Toggle device active/inactive status
export async function toggleDeviceStatus(deviceId: number) {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) {
        return { success: false, message: "Unauthorized" };
    }

    const [device] = await db.select({ isActive: devices.isActive }).from(devices).where(eq(devices.id, deviceId));
    if (!device) return { success: false, message: "Device not found" };

    const newStatus = !device.isActive;
    await db.update(devices).set({ isActive: newStatus }).where(eq(devices.id, deviceId));

    revalidatePath("/admin");
    return { success: true, isActive: newStatus, message: `Device ${newStatus ? "activated" : "deactivated"} successfully.` };
}

// Take out device from rack (clear rack position)
export async function takeoutFromRack(deviceId: number) {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) {
        return { success: false, message: "Unauthorized" };
    }

    const [device] = await db.select({ isActive: devices.isActive, rackName: devices.rackName }).from(devices).where(eq(devices.id, deviceId));
    if (!device) return { success: false, message: "Device not found" };
    if (device.isActive) return { success: false, message: "Device must be deactivated before taking out from rack." };
    if (!device.rackName) return { success: false, message: "Device is not in any rack." };

    await db.update(devices).set({ rackName: null, rackPosition: null, uHeight: null, zone: null }).where(eq(devices.id, deviceId));

    revalidatePath("/admin");
    revalidatePath("/admin/rack");
    return { success: true, message: "Device taken out from rack successfully." };
}
