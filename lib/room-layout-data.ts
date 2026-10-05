import "server-only";
import { and, eq, inArray, asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { devices, locations, racks } from "@/db/schema";
import { facilityDimensions } from "./facility-asset";
import { layoutRacks } from "@/components/rack3d/layout";
import { RACK_W, RACK_D, rackHeight } from "@/components/rack3d/constants";
import type { Footprint } from "./room-layout";

export type LayoutTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function lockLayoutRooms(tx: LayoutTransaction, siteId: number, ids: (number | null | undefined)[]) {
    const keys = [...new Set(ids.filter((id): id is number => id != null))].sort((a, b) => a - b);
    if (!keys.length) return [];
    const rows = await tx.select().from(locations)
        .where(and(eq(locations.siteId, siteId), inArray(locations.id, keys))).orderBy(asc(locations.id)).for("update");
    if (rows.length !== keys.length) throw new Error("Ruangan tidak ditemukan di site aktif.");
    return rows;
}

export async function bumpLayoutRevision(tx: LayoutTransaction, siteId: number, ids: (number | null | undefined)[]) {
    const keys = [...new Set(ids.filter((id): id is number => id != null))];
    if (keys.length) await tx.update(locations).set({ layoutRevision: sql`${locations.layoutRevision} + 1` })
        .where(and(eq(locations.siteId, siteId), inArray(locations.id, keys)));
}

export async function readRoomAssets(tx: LayoutTransaction | typeof db, siteId: number, roomId: number) {
    const roomRacks = await tx.select().from(racks).where(and(eq(racks.siteId, siteId), eq(racks.locationId, roomId))).orderBy(asc(racks.id));
    const facilities = await tx.select().from(devices).where(and(eq(devices.siteId, siteId), eq(devices.locationId, roomId), inArray(devices.assetType, ["pac", "ups"]))).orderBy(asc(devices.id));
    return { roomRacks, facilities };
}

export function roomAssetFootprints(data: Awaited<ReturnType<typeof readRoomAssets>>, manual: boolean): Footprint[] {
    const legacy = layoutRacks(data.roomRacks.map((r) => ({ ...r, layoutMode: "legacy" })));
    // Legacy facility coordinates share the existing centred rack scene.
    // The editor translates both together when upgrading to manual room origin.
    return [
        ...data.roomRacks.flatMap((rack): Footprint[] => {
            const p = legacy.find((v) => v.rack.id === rack.id);
            const x = manual ? rack.floorX : (p ? p.x : null);
            const z = manual ? rack.floorZ : (p ? p.z : null);
            if (x == null || z == null) return [];
            return [{ key: `rack:${rack.id}`, x, z, rotation: manual ? rack.floorRotation ?? 0 : rack.facing === "back" ? 180 : 0,
                width: RACK_W, depth: RACK_D, height: rackHeight(rack.totalU ?? 42), estimated: true }];
        }),
        ...data.facilities.flatMap((asset): Footprint[] => asset.floorX == null || asset.floorZ == null ? [] : [{
            key: `device:${asset.id}`, x: asset.floorX, z: asset.floorZ, rotation: asset.floorRotation ?? 0, ...facilityDimensions(asset),
        }]),
    ];
}
