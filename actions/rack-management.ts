"use server";

import { db } from "../db";
import { racks, locations, devices } from "../db/schema";
import { and, eq, asc, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifySession } from "../lib/session";
import { logAudit } from "../lib/audit";
import { requireActiveSiteAction, requireActiveSiteAdminAction } from "../lib/action-auth";
import type { RackMove } from "../lib/rack-order";
import { lockLayoutRooms, bumpLayoutRevision } from "@/lib/room-layout-data";
import { rackHeight } from "@/components/rack3d/constants";

// Form checkboxes submit "on" when checked; an unchecked checkbox submits
// its hidden "false" twin (the browser never sends the field at all
// otherwise). z.coerce.boolean() would coerce the string "false" to true
// (any non-empty string is truthy), so parse the form values explicitly.
const formBoolean = z
    .union([z.boolean(), z.enum(["on", "true", "false"])])
    .transform((v) => v === true || v === "on" || v === "true");

// Schema
const rackSchema = z.object({
    name: z.string().min(1, "Rack name is required"),
    zone: z.string().optional(),
    totalU: z.coerce.number().min(1).max(60).default(42),
    // The edit form's "-- No Location --" option submits "" → coerce → 0;
    // normalize to null so clearing the location is a valid update instead
    // of an FK violation on locations.id=0.
    locationId: z.coerce.number().optional().transform((v) => (v === 0 ? null : v)),
    isAuditable: formBoolean.optional(),
    // 3D floor position. Omitted field = keep stored value (partial update);
    // explicit "" = clear to null.
    floorRow: z.string().trim().max(4, "Row maksimal 4 karakter").optional()
        .transform((v) => (v === undefined ? undefined : v === "" ? null : v.toUpperCase())),
    floorSlot: z.union([z.literal(""), z.coerce.number().int().min(1, "Slot minimal 1").max(99, "Slot maksimal 99")]).optional()
        .transform((v) => (v === undefined ? undefined : v === "" ? null : v)),
    facing: z.enum(["front", "back"]).optional(),
});

// Get all racks (filtered by active site)
export async function getRacks() {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return [];

    return await db.select({
        id: racks.id,
        siteId: racks.siteId,
        name: racks.name,
        zone: racks.zone,
        totalU: racks.totalU,
        locationId: racks.locationId,
        locationName: locations.name,
        createdAt: racks.createdAt,
        isAuditable: racks.isAuditable,
        floorRow: racks.floorRow,
        floorSlot: racks.floorSlot,
        facing: racks.facing,
    })
        .from(racks)
        .leftJoin(locations, eq(racks.locationId, locations.id))
        .where(eq(racks.siteId, auth.activeSiteId)).orderBy(asc(racks.name));
}

// Get occupied slots for a specific rack
export async function getOccupiedSlots(rackName: string, excludeDeviceId?: number) {
    const session = await verifySession();
    if (!session) return {};
    if (!session.activeSiteId) return {};

    const { devices } = await import("../db/schema");
    const { eq, and, isNotNull, ne } = await import("drizzle-orm");

    const conditions = [
        eq(devices.siteId, session.activeSiteId),
        // Case-insensitive match so 'rack A' land on the same rack as 'Rack A'
        // (getRackLayout merges by lowercased name, #33)
        sql`lower(${devices.rackName}) = lower(${rackName})`,
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
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return null;

    return await db.query.racks.findFirst({
        where: and(eq(racks.id, id), eq(racks.siteId, auth.activeSiteId)),
    });
}

// Add rack
export async function addRack(prevState: unknown, formData: FormData) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { message: auth.message };

    const parsed = rackSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
        return { errors: parsed.error.flatten().fieldErrors };
    }

    try {
        const insertRack = (handle: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]) => handle.insert(racks).values({
            siteId: auth.activeSiteId,
            name: parsed.data.name,
            zone: parsed.data.zone || null,
            totalU: parsed.data.totalU || 42,
            locationId: parsed.data.locationId || null,
            isAuditable: parsed.data.isAuditable ?? true,
            floorRow: parsed.data.floorRow ?? null,
            floorSlot: parsed.data.floorSlot ?? null,
            facing: parsed.data.facing ?? "front",
        });
        if (parsed.data.locationId) await db.transaction(async (tx) => {
            await lockLayoutRooms(tx, auth.activeSiteId, [parsed.data.locationId]);
            await insertRack(tx);
            await bumpLayoutRevision(tx, auth.activeSiteId, [parsed.data.locationId]);
        }); else await insertRack(db);

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
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { message: auth.message };

    const id = Number(formData.get("id"));
    if (!id) {
        return { message: "ID Rak tidak valid atau tidak ditemukan." };
    }

    const parsed = rackSchema.partial().safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
        return { errors: parsed.error.flatten().fieldErrors };
    }

    try {
        const current = await db.query.racks.findFirst({
            where: and(eq(racks.id, id), eq(racks.siteId, auth.activeSiteId)),
        });
        if (!current) return { message: "Rack tidak ditemukan di site aktif." };

        // Partial updates must only change fields the caller actually sent:
        // absent isAuditable keeps the stored value (never force-flips to
        // false), and an absent zone keeps the stored zone while an explicit
        // empty string clears it to NULL (matching addRack's || null).
        const saveRack = (handle: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]) => handle.update(racks).set({
            name: parsed.data.name,
            zone: parsed.data.zone === undefined ? current.zone : (parsed.data.zone === "" ? null : parsed.data.zone),
            totalU: parsed.data.totalU,
            locationId: parsed.data.locationId,
            isAuditable: parsed.data.isAuditable ?? current.isAuditable,
            floorRow: parsed.data.floorRow,
            floorSlot: parsed.data.floorSlot,
            facing: parsed.data.facing,
            ...(parsed.data.locationId !== undefined && parsed.data.locationId !== current.locationId ? { floorX: null, floorZ: null, floorRotation: null } : {}),
        }).where(and(eq(racks.id, id), eq(racks.siteId, auth.activeSiteId)));
        if (current.locationId || parsed.data.locationId) await db.transaction(async (tx) => {
            const roomRows = await lockLayoutRooms(tx, auth.activeSiteId, [current.locationId, parsed.data.locationId]);
            const [locked] = await tx.select().from(racks).where(and(eq(racks.id, id), eq(racks.siteId, auth.activeSiteId))).for("update");
            if (!locked || locked.locationId !== current.locationId || locked.name !== current.name || locked.totalU !== current.totalU) throw new Error("Rack berubah. Muat ulang form.");
            if (roomRows.some((r) => r.id === current.locationId && r.layoutMode === "manual") && ((parsed.data.floorRow !== undefined && parsed.data.floorRow !== current.floorRow) || (parsed.data.floorSlot !== undefined && parsed.data.floorSlot !== current.floorSlot) || (parsed.data.facing !== undefined && parsed.data.facing !== current.facing))) {
                throw new Error("Gunakan Atur Layout Ruangan untuk posisi room manual.");
            }
            const currentRoom = roomRows.find((r) => r.id === current.locationId);
            if (currentRoom?.layoutMode === "manual" && locked.floorX !== null && parsed.data.totalU !== undefined && rackHeight(parsed.data.totalU) > currentRoom.roomHeightM!) throw new Error("Tinggi rack melebihi ruangan; ubah layout atau lepas penempatan dahulu.");
            await saveRack(tx);
            await bumpLayoutRevision(tx, auth.activeSiteId, [current.locationId, parsed.data.locationId]);
        }); else await saveRack(db);

        // Cascade rename to devices referencing this rack by name
        // (case-insensitive match, consistent with the merged layout, #33)
        if (parsed.data.name && parsed.data.name !== current.name) {
            await db.update(devices).set({ rackName: parsed.data.name })
                .where(and(
                    eq(devices.siteId, auth.activeSiteId),
                    sql`lower(${devices.rackName}) = lower(${current.name})`,
                ));
        }

        revalidatePath("/admin/rack-manage");
        revalidatePath("/admin/rack");
        await logAudit({ action: "UPDATE", entity: "rack", entityId: id, entityName: parsed.data.name, detail: `U: ${parsed.data.totalU}` });
        return { success: true, message: "Rack updated successfully" };
    } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
            return { message: "Nama rak ini sudah terdaftar. Silakan gunakan nama lain." };
        }
        if (error instanceof Error && /Gunakan Atur Layout|Rack berubah|Ruangan tidak ditemukan|Tinggi rack/.test(error.message)) return { message: error.message };
        return { message: "Terjadi kesalahan saat memperbarui konfigurasi rak." };
    }
}

// Delete rack
export async function deleteRack(id: number) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { message: auth.message };

    // devices.rack_name is free text with no FK to racks, so the delete would
    // always "succeed" while getRackLayout immediately resurrects the rack
    // (default 42U, lost zone) from the referencing device rows. Refuse the
    // deletion while any device in the active site references this rack.
    const rackInUseMessage = "Gagal menghapus rak ini karena mungkin masih berisi perangkat server aktif.";

    try {
        const rack = await db.query.racks.findFirst({
            where: and(eq(racks.id, id), eq(racks.siteId, auth.activeSiteId)),
            columns: { name: true, locationId: true },
        });
        if (!rack) return { message: "Rak tidak ditemukan di site aktif." };

        const [{ deviceCount }] = await db
            .select({ deviceCount: sql<number>`count(*)` })
            .from(devices)
            .where(and(
                eq(devices.siteId, auth.activeSiteId),
                sql`lower(${devices.rackName}) = lower(${rack.name})`,
            ));

        if (deviceCount > 0) {
            return { message: rackInUseMessage };
        }

        if (rack.locationId) await db.transaction(async (tx) => {
            await lockLayoutRooms(tx, auth.activeSiteId, [rack.locationId]);
            const [locked] = await tx.select().from(racks).where(and(eq(racks.id, id), eq(racks.siteId, auth.activeSiteId))).for("update");
            if (!locked || locked.locationId !== rack.locationId || locked.name !== rack.name) throw new Error("Rack berubah.");
            const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(devices).where(and(eq(devices.siteId, auth.activeSiteId), sql`lower(${devices.rackName}) = lower(${locked.name})`));
            if (count > 0) throw new Error(rackInUseMessage);
            await tx.delete(racks).where(and(eq(racks.id, id), eq(racks.siteId, auth.activeSiteId)));
            await bumpLayoutRevision(tx, auth.activeSiteId, [rack.locationId]);
        }); else await db.delete(racks).where(and(eq(racks.id, id), eq(racks.siteId, auth.activeSiteId)));

        revalidatePath("/admin/rack-manage");
        revalidatePath("/admin/rack");
        await logAudit({ action: "DELETE", entity: "rack", entityId: id, entityName: rack.name });
        return { success: true };
    } catch {
        return { message: rackInUseMessage };
    }
}

// Toggle rack's audit eligibility
export async function toggleRackAudit(id: number) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { message: auth.message };

    const rack = await db.query.racks.findFirst({
        where: and(eq(racks.id, id), eq(racks.siteId, auth.activeSiteId)),
    });
    if (!rack) return { message: "Rack tidak ditemukan di site aktif." };

    await db.update(racks).set({ isAuditable: !rack.isAuditable })
        .where(and(eq(racks.id, id), eq(racks.siteId, auth.activeSiteId)));

    revalidatePath("/admin/rack-manage");
    revalidatePath("/admin/rack");
    await logAudit({ action: "UPDATE", entity: "rack", entityId: id, entityName: rack.name, detail: `Audit: ${rack.isAuditable ? 'off' : 'on'}` });
    return { success: true };
}

// Drag-to-reorder from the 2D layout: new row/slot per moved rack. Racks are
// keyed by name (unique per site, case-insensitive) because the layout also
// shows legacy device-only racks that have no racks row; those cannot be
// reordered and the whole move is refused. One transaction: a partial
// reorder would leave two racks claiming the same slot.
const reorderSchema = z.array(z.object({
    name: z.string().min(1),
    floorRow: z.string().trim().max(4).nullable()
        .transform((v) => (v ? v.toUpperCase() : null)),
    floorSlot: z.number().int().min(1).max(99),
})).min(1).max(500);

export async function reorderRacks(moves: RackMove[]) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { message: auth.message };

    const parsed = reorderSchema.safeParse(moves);
    if (!parsed.success) return { message: "Urutan rak tidak valid." };

    const keys = parsed.data.map((m) => m.name.toLowerCase());
    const roomCandidates = await db.select({ locationId: racks.locationId }).from(racks).where(and(eq(racks.siteId, auth.activeSiteId), inArray(sql`lower(${racks.name})`, keys)));
    const result = await db.transaction(async (tx) => {
        const lockedRooms = await lockLayoutRooms(tx, auth.activeSiteId, roomCandidates.map((r) => r.locationId));
        if (lockedRooms.some((r) => r.layoutMode === "manual")) return { message: "Room manual menggunakan Atur Layout Ruangan." };
        const owned = await tx.select({ id: racks.id, name: racks.name, locationId: racks.locationId }).from(racks)
            .where(and(eq(racks.siteId, auth.activeSiteId), inArray(sql`lower(${racks.name})`, keys)))
            .for("update");
        if (owned.some((r) => r.locationId != null && !lockedRooms.some((room) => room.id === r.locationId))) return { message: "Lokasi rack berubah. Muat ulang layout." };
        const byKey = new Map(owned.map((r) => [r.name.toLowerCase(), r.id]));
        const missing = parsed.data.find((m) => !byKey.has(m.name.toLowerCase()));
        if (missing) return { message: `Rak "${missing.name}" belum terdaftar di Racks site ini. Tambahkan dulu sebelum mengatur urutan.` };

        for (const m of parsed.data) {
            await tx.update(racks).set({ floorRow: m.floorRow, floorSlot: m.floorSlot })
                .where(and(eq(racks.id, byKey.get(m.name.toLowerCase())!), eq(racks.siteId, auth.activeSiteId)));
        }
        await bumpLayoutRevision(tx, auth.activeSiteId, owned.map((r) => r.locationId));
        return { success: true as const };
    });
    if (!("success" in result)) return result;

    revalidatePath("/admin/rack");
    revalidatePath("/admin/rack-manage");
    await logAudit({ action: "UPDATE", entity: "rack", entityName: parsed.data.map((m) => m.name).join(", "), detail: "Reordered floor position" });
    return result;
}
