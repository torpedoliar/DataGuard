"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { devices, locations, racks } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { roomLayoutSchema, validateRoomLayout } from "@/lib/room-layout";
import { lockLayoutRooms, readRoomAssets, roomAssetFootprints } from "@/lib/room-layout-data";
import { facilityDimensions } from "@/lib/facility-asset";
import { RACK_W, RACK_D, rackHeight } from "@/components/rack3d/constants";
import { resolveAppearance } from "@/lib/room-appearance";

export async function getRoomLayout(roomId: number) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { success: false as const, message: auth.message };
    const room = await db.query.locations.findFirst({ where: and(eq(locations.id, roomId), eq(locations.siteId, auth.activeSiteId)) });
    if (!room) return { success: false as const, message: "Ruangan tidak ditemukan." };
    const data = await readRoomAssets(db, auth.activeSiteId, roomId);
    const footprints = roomAssetFootprints(data, room.layoutMode === "manual");
    return { success: true as const, siteId: auth.activeSiteId, room, appearance: resolveAppearance(room), sourceRacks: data.roomRacks, sourceFacilities: data.facilities, assets: [
        ...data.roomRacks.map((rack) => ({ key: `rack:${rack.id}`, name: rack.name, kind: "rack" as const,
            width: RACK_W, depth: RACK_D, height: rackHeight(rack.totalU ?? 42), estimated: true,
            x: footprints.find((p) => p.key === `rack:${rack.id}`)?.x ?? null,
            z: footprints.find((p) => p.key === `rack:${rack.id}`)?.z ?? null,
            rotation: footprints.find((p) => p.key === `rack:${rack.id}`)?.rotation ?? null })),
        ...data.facilities.map((asset) => ({ key: `device:${asset.id}`, name: asset.name, kind: asset.assetType,
            ...facilityDimensions(asset), x: asset.floorX, z: asset.floorZ, rotation: asset.floorRotation })),
    ] };
}

export async function saveRoomLayout(input: unknown) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { success: false as const, message: auth.message };
    const parsed = roomLayoutSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, message: "Layout ruangan tidak valid." };
    const value = parsed.data;
    if (value.siteId !== auth.activeSiteId) return { success: false as const, message: "Site aktif berubah. Muat ulang layout." };
    try {
        await db.transaction(async (tx) => {
            const [room] = await lockLayoutRooms(tx, auth.activeSiteId, [value.roomId]);
            if (room.layoutRevision !== value.revision) throw new Error("Layout telah berubah. Muat ulang sebelum menyimpan.");
            const data = await readRoomAssets(tx, auth.activeSiteId, room.id);
            const expected = [...data.roomRacks.map((r) => `rack:${r.id}`), ...data.facilities.map((d) => `device:${d.id}`)];
            if (expected.length !== value.assets.length || expected.some((key) => !value.assets.some((a) => a.key === key))) {
                throw new Error("Daftar aset berubah atau bukan milik ruangan. Muat ulang layout.");
            }
            const footprints = value.assets.flatMap((asset) => {
                if (asset.x === null || asset.z === null || asset.rotation === null) return [];
                const rack = data.roomRacks.find((r) => asset.key === `rack:${r.id}`);
                const device = data.facilities.find((d) => asset.key === `device:${d.id}`);
                const dimensions = rack ? { width: RACK_W, depth: RACK_D, height: rackHeight(rack.totalU ?? 42), estimated: true } : facilityDimensions(device!);
                return [{ ...asset, x: asset.x, z: asset.z, rotation: asset.rotation, ...dimensions }];
            });
            const validation = validateRoomLayout(value, footprints);
            if (validation.errors.length) throw new Error(validation.errors.join(" "));
            if (validation.warnings.length && !value.acknowledgeEstimated) throw new Error("Konfirmasi ukuran model generik/clearance belum terverifikasi.");
            for (const asset of [...value.assets].sort((a, b) => a.key.localeCompare(b.key))) {
                const id = Number(asset.key.split(":")[1]);
                const position = { floorX: asset.x, floorZ: asset.z, floorRotation: asset.rotation === null ? null : ((asset.rotation % 360) + 360) % 360 };
                if (asset.key.startsWith("rack:")) {
                    await tx.update(racks).set(position).where(and(eq(racks.id, id), eq(racks.siteId, auth.activeSiteId), eq(racks.locationId, room.id)));
                } else {
                    await tx.update(devices).set(position).where(and(eq(devices.id, id), eq(devices.siteId, auth.activeSiteId), eq(devices.locationId, room.id)));
                }
            }
            await tx.update(locations).set({ roomWidthM: value.width, roomDepthM: value.depth, roomHeightM: value.height,
                layoutMode: "manual", layoutRevision: room.layoutRevision + 1 }).where(eq(locations.id, room.id));
        });
    } catch (error) {
        return { success: false as const, message: error instanceof Error ? error.message : "Gagal menyimpan layout." };
    }
    // Persistence succeeded; ancillary failures must not suggest a rollback.
    try {
        revalidatePath("/admin/rack");
        revalidatePath("/admin/locations");
        await logAudit({ action: "UPDATE", entity: "location", entityId: value.roomId, detail: `Room layout revision ${value.revision + 1}; ${value.width} × ${value.depth} × ${value.height} m; ${JSON.stringify(value.assets)}` });
    } catch (error) { console.error("Room layout saved; post-save notification failed:", error); }
    return { success: true as const, message: "Layout tersimpan." };
}
