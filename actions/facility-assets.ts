"use server";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, devices } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { conversionSchema, matchesConversionOriginal } from "@/lib/facility-conversion";
import { facilityDimensions } from "@/lib/facility-asset";
import { lockLayoutRooms, readRoomAssets, roomAssetFootprints, bumpLayoutRevision } from "@/lib/room-layout-data";
import { validateRoomLayout } from "@/lib/room-layout";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export async function convertFacilityDevice(input: unknown) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { success: false as const, message: auth.message };
    const parsed = conversionSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, message: "Data konversi tidak valid." };
    const value = parsed.data;
    if (value.siteId !== auth.activeSiteId) return { success: false as const, message: "Site aktif berubah. Buka ulang wizard." };
    try {
        await db.transaction(async (tx) => {
            const rooms = await lockLayoutRooms(tx, auth.activeSiteId, [value.original.locationId, value.asset.locationId]);
            const [current] = await tx.select().from(devices).where(and(eq(devices.id, value.deviceId), eq(devices.siteId, auth.activeSiteId))).for("update");
            if (!current || current.assetType !== "standard") throw new Error("Perangkat tidak ditemukan atau sudah dikonversi.");
            if (!matchesConversionOriginal({ ...current, assetType: "standard" }, value.original)) throw new Error("Data perangkat berubah. Buka ulang wizard.");
            const target = rooms.find((r) => r.id === value.asset.locationId);
            if (target && target.layoutRevision !== value.roomRevision) throw new Error("Layout ruangan berubah. Pilih ulang penempatan.");
            if (value.asset.floorX !== null && target) {
                const data = await readRoomAssets(tx, auth.activeSiteId, target.id);
                const existing = roomAssetFootprints(data, target.layoutMode === "manual");
                const footprint = { key: `device:${current.id}`, x: value.asset.floorX, z: value.asset.floorZ!, rotation: value.asset.floorRotation!, ...facilityDimensions(value.asset) };
                if (target.layoutMode === "manual") {
                    const validation = validateRoomLayout({ width: target.roomWidthM!, depth: target.roomDepthM!, height: target.roomHeightM! }, [...existing, footprint]);
                    if (validation.errors.length) throw new Error(validation.errors.join(" "));
                    if (validation.warnings.length && !value.acknowledgeEstimated) throw new Error("Konfirmasi ukuran generik dan clearance belum terverifikasi.");
                } else {
                    // Legacy has no measured room boundary; still check footprints.
                    // Translate centred legacy positions for collision checking only.
                    const candidates = [...existing, footprint];
                    const dx = 2 - Math.min(0, ...candidates.map((a) => a.x - a.width));
                    const dz = 2 - Math.min(0, ...candidates.map((a) => a.z - a.depth));
                    const validation = validateRoomLayout({ width: 3000, depth: 3000, height: 100 }, candidates.map((a) => ({ ...a, x: a.x + dx, z: a.z + dz })));
                    if (validation.errors.length) throw new Error(validation.errors.join(" "));
                    if (!value.acknowledgeEstimated) throw new Error("Layout legacy/ukuran generik memerlukan konfirmasi clearance.");
                }
            }
            const categoryName = value.asset.assetType === "pac" ? "Cooling" : "Power";
            // Serialize category creation across sites; global category names are unique.
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`facility-category:${categoryName}`}))`);
            let [category] = await tx.select({ id: categories.id }).from(categories).where(sql`lower(${categories.name}) = lower(${categoryName})`);
            if (!category) [category] = await tx.insert(categories).values({ name: categoryName, color: value.asset.assetType === "pac" ? "#0284c7" : "#d97706" }).returning({ id: categories.id });
            await tx.update(devices).set({ assetType: value.asset.assetType, facilitySpecs: value.asset.facilitySpecs,
                categoryId: category.id, locationId: value.asset.locationId, floorX: value.asset.floorX, floorZ: value.asset.floorZ,
                floorRotation: value.asset.floorRotation, rackName: null, rackPosition: null, uHeight: null,
            }).where(and(eq(devices.id, current.id), eq(devices.siteId, auth.activeSiteId)));
            await bumpLayoutRevision(tx, auth.activeSiteId, [current.locationId, value.asset.locationId]);
        });
    } catch (error) {
        return { success: false as const, message: error instanceof Error ? error.message : "Konversi gagal; tidak ada perubahan tersimpan." };
    }
    try {
        revalidatePath("/admin", "layout");
        revalidatePath("/admin/rack");
        revalidatePath("/checklist");
        await logAudit({ action: "UPDATE", entity: "device", entityId: value.deviceId,
            detail: `Converted to ${value.asset.assetType}; original=${JSON.stringify(value.original)}; placement=${JSON.stringify({ locationId: value.asset.locationId, x: value.asset.floorX, z: value.asset.floorZ, rotation: value.asset.floorRotation })}` });
    } catch (error) { console.error("Facility conversion saved; post-save notification failed:", error); }
    return { success: true as const, message: "Konversi tersimpan; identitas dan riwayat tetap." };
}
