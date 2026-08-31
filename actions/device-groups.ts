"use server";

import { db } from "@/db";
import { deviceGroups, devicePics, devices, userSites, users } from "@/db/schema";
import { and, eq, inArray, asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";

// A PIC group (device_groups) is per-site. Device↔group membership lives in
// device_pics. The responsible owners (PICs) are the group's users, stored in
// users.responsible_for_groups as an array of group ids.
//
// i18n note (finding #71): these server-action error strings stay Indonesian
// per the repository-wide partial-i18n pattern documented under finding #38;
// the client localizes its own UI strings via next-intl.

const groupSchema = z.object({
  name: z.string().min(1, "Group name is required"),
  description: z.string().optional(),
  color: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid color hex").default("#3b82f6"),
  // Form checkbox: present with value "on" when checked, absent when unchecked.
  isActive: z.literal("on").optional(),
});

export type DeviceGroupWithPics = Awaited<ReturnType<typeof getDeviceGroups>>[number];

// The transaction handle type as seen by db.transaction((tx) => …) callbacks.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Thrown by resolveBinding when a bind input fails site validation. The
// callers translate it into an honest user-facing message (finding #27).
class BindingError extends Error {}

// Resolve bind membership against the active site (finding #27): device ids
// must belong to the site and owner ids must be active users with a userSites
// row for the site (superadmin owners are exempt — they implicitly have access
// to every site). The whole request is rejected when any id fails so the UI is
// never told a save succeeded while memberships were silently dropped. Runs
// inside the caller's transaction so the rejection rolls back the mutation.
async function resolveBinding(
  tx: Tx,
  siteId: number,
  requestedDeviceIds: number[],
  requestedOwnerIds: number[],
) {
  let deviceIds = requestedDeviceIds;
  if (deviceIds.length > 0) {
    const rows = await tx
      .select({ id: devices.id })
      .from(devices)
      .where(and(inArray(devices.id, deviceIds), eq(devices.siteId, siteId)));
    deviceIds = rows.map((r) => r.id);
    const dropped = requestedDeviceIds.length - deviceIds.length;
    if (dropped > 0) throw new BindingError(`${dropped} perangkat tidak valid untuk site aktif.`);
  }

  let ownerIds = requestedOwnerIds;
  if (ownerIds.length > 0) {
    const candidates = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(and(inArray(users.id, ownerIds), eq(users.isActive, true)));
    const superadmins = candidates.filter((u) => u.role === "superadmin").map((u) => u.id);
    const needSiteAccess = candidates.filter((u) => u.role !== "superadmin").map((u) => u.id);
    let withSite = new Set<number>();
    if (needSiteAccess.length > 0) {
      const rows = await tx
        .select({ userId: userSites.userId })
        .from(userSites)
        .where(and(inArray(userSites.userId, needSiteAccess), eq(userSites.siteId, siteId)));
      withSite = new Set(rows.map((r) => r.userId));
    }
    ownerIds = [
      ...superadmins,
      ...candidates.filter((u) => u.role !== "superadmin" && withSite.has(u.id)).map((u) => u.id),
    ];
    const dropped = requestedOwnerIds.length - ownerIds.length;
    if (dropped > 0) throw new BindingError(`${dropped} pengguna tidak memiliki akses ke site aktif.`);
  }

  return { deviceIds, ownerIds };
}

// Re-sync device_pics + users.responsible_for_groups for one group. Caller has
// already validated the membership lists against the site (finding #27) and
// must be inside a transaction so the row + memberships commit atomically
// (finding #26).
async function bindGroup(tx: Tx, groupId: number, siteId: number, deviceIds: number[], ownerIds: number[]) {
  await tx.delete(devicePics).where(eq(devicePics.groupId, groupId));
  if (deviceIds.length > 0) {
    await tx.insert(devicePics).values(deviceIds.map((deviceId) => ({ deviceId, groupId, siteId })));
  }

  // owner assignments: rewrite responsible_for_groups across affected users
  await detachOwners(tx, groupId);
  if (ownerIds.length > 0) {
    const owners = await tx.select({ id: users.id, responsibleForGroups: users.responsibleForGroups }).from(users)
      .where(inArray(users.id, ownerIds));
    for (const user of owners) {
      const current = new Set((user.responsibleForGroups ?? []).map(Number));
      current.add(groupId);
      await tx.update(users).set({ responsibleForGroups: [...current].map(String) }).where(eq(users.id, user.id));
    }
  }
}

// Remove groupId from every user's responsible_for_groups. Runs inside the tx
// so the rewrite and the group mutation commit or roll back together (finding
// #26).
async function detachOwners(tx: Tx, groupId: number) {
  const all = await tx.select({ id: users.id, responsibleForGroups: users.responsibleForGroups }).from(users);
  for (const user of all) {
    const list = (user.responsibleForGroups ?? []).map(Number).filter((gid) => gid !== groupId);
    if (list.length !== (user.responsibleForGroups ?? []).length) {
      await tx.update(users).set({ responsibleForGroups: list.map(String) }).where(eq(users.id, user.id));
    }
  }
}

// All groups for current site + bound device ids + owner user ids
export async function getDeviceGroups() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return [];

  const groups = await db.query.deviceGroups.findMany({
    where: eq(deviceGroups.siteId, auth.activeSiteId),
    orderBy: [asc(deviceGroups.name)],
  });

  if (groups.length === 0) return [];

  const groupIds = groups.map((g) => g.id);
  const pics = await db
    .select({ deviceId: devicePics.deviceId, groupId: devicePics.groupId })
    .from(devicePics)
    .where(inArray(devicePics.groupId, groupIds));
  const picsByGroup = new Map<number, number[]>();
  for (const p of pics) {
    const list = picsByGroup.get(p.groupId) ?? [];
    list.push(p.deviceId);
    picsByGroup.set(p.groupId, list);
  }

  // owners = user ids whose responsible_for_groups includes this group
  const potentialOwners = await db
    .select({ id: users.id, responsibleForGroups: users.responsibleForGroups })
    .from(users);
  const ownerByGroup = new Map<number, number[]>();
  for (const u of potentialOwners) {
    for (const gid of u.responsibleForGroups ?? []) {
      const list = ownerByGroup.get(Number(gid)) ?? [];
      list.push(u.id);
      ownerByGroup.set(Number(gid), list);
    }
  }

  return groups.map((g) => ({
    ...g,
    deviceIds: picsByGroup.get(g.id) ?? [],
    ownerIds: ownerByGroup.get(g.id) ?? [],
  }));
}

export async function getDeviceGroup(id: number) {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return null;
  return db.query.deviceGroups.findFirst({
    where: and(eq(deviceGroups.id, id), eq(deviceGroups.siteId, auth.activeSiteId)),
  });
}

export async function addDeviceGroup(prevState: unknown, formData: FormData) {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const parsed = groupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  // owner user ids (PIC assignments)
  const ownerIds = (formData.getAll("ownerIds") as string[]).map(Number).filter((n) => !Number.isNaN(n));
  const deviceIds = (formData.getAll("deviceIds") as string[]).map(Number).filter((n) => !Number.isNaN(n));
  const isActive = parsed.data.isActive === "on";

  try {
    const groupId = await db.transaction(async (tx) => {
      const binding = await resolveBinding(tx, auth.activeSiteId, deviceIds, ownerIds);
      const [group] = await tx.insert(deviceGroups).values({
        siteId: auth.activeSiteId,
        name: parsed.data.name,
        description: parsed.data.description || null,
        color: parsed.data.color,
        isActive,
      }).returning({ id: deviceGroups.id });

      await bindGroup(tx, group.id, auth.activeSiteId, binding.deviceIds, binding.ownerIds);
      return group.id;
    });

    revalidatePath("/admin/device-groups");
    revalidatePath("/admin");
    await logAudit({ action: "CREATE", entity: "device_group", entityId: groupId, entityName: parsed.data.name, detail: `${deviceIds.length} devices, ${ownerIds.length} owners` });
    return { success: true, message: "Group created" };
  } catch (e) {
    if (e instanceof BindingError) return { message: e.message };
    console.error("Add group error:", e);
    return { message: "Gagal menyimpan grup." };
  }
}

export async function updateDeviceGroup(prevState: unknown, formData: FormData) {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const id = Number(formData.get("id"));
  if (!id) return { message: "ID grup tidak valid." };

  const parsed = groupSchema.partial().safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const existing = await db.query.deviceGroups.findFirst({
    where: and(eq(deviceGroups.id, id), eq(deviceGroups.siteId, auth.activeSiteId)),
  });
  if (!existing) return { message: "Grup tidak ditemukan." };

  const ownerIds = (formData.getAll("ownerIds") as string[]).map(Number).filter((n) => !Number.isNaN(n));
  const deviceIds = (formData.getAll("deviceIds") as string[]).map(Number).filter((n) => !Number.isNaN(n));
  // The checkbox fully determines the value: it renders defaultChecked from the
  // existing row, so an absent field means the admin unchecked it.
  const isActive = parsed.data.isActive === "on";

  try {
    await db.transaction(async (tx) => {
      const binding = await resolveBinding(tx, auth.activeSiteId, deviceIds, ownerIds);
      await tx.update(deviceGroups).set({
        name: parsed.data.name ?? existing.name,
        description: parsed.data.description ?? existing.description,
        color: parsed.data.color ?? existing.color,
        isActive,
        updatedAt: new Date(), // finding #70: keep updated_at in sync
      }).where(eq(deviceGroups.id, id));

      await bindGroup(tx, id, auth.activeSiteId, binding.deviceIds, binding.ownerIds);
    });

    revalidatePath("/admin/device-groups");
    revalidatePath("/admin");
    await logAudit({ action: "UPDATE", entity: "device_group", entityId: id, entityName: existing.name, detail: `${deviceIds.length} devices, ${ownerIds.length} owners` });
    return { success: true, message: "Group updated" };
  } catch (e) {
    if (e instanceof BindingError) return { message: e.message };
    console.error("Update group error:", e);
    return { message: "Gagal menyimpan perubahan grup." };
  }
}

export async function deleteDeviceGroup(id: number) {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };
  try {
    const existing = await db.query.deviceGroups.findFirst({
      where: and(eq(deviceGroups.id, id), eq(deviceGroups.siteId, auth.activeSiteId)),
    });
    if (!existing) return { message: "Grup tidak ditemukan." };

    await db.transaction(async (tx) => {
      // Detach owners BEFORE deleting the group row so the users rewrite and
      // the group deletion commit or roll back together (finding #26).
      await detachOwners(tx, id);
      // device_pics.group_id is ON DELETE CASCADE; delete explicitly so the
      // membership cleanup and the row removal are one atomic unit.
      await tx.delete(devicePics).where(eq(devicePics.groupId, id));
      await tx.delete(deviceGroups).where(eq(deviceGroups.id, id));
    });

    revalidatePath("/admin/device-groups");
    await logAudit({ action: "DELETE", entity: "device_group", entityId: id, entityName: existing.name });
    return { success: true };
  } catch (e) {
    console.error("Delete group error:", e);
    return { message: "Gagal menghapus grup." };
  }
}

export type UserForGroup = { id: number; username: string };
export async function getGroupUsers() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return [];

  // PIC picker is scoped to the active site (finding #28): regular users must
  // have a userSites row for the site; superadmin sees every active user.
  // Deactivated users are never assignable.
  if (auth.session.role === "superadmin") {
    return db.select({ id: users.id, username: users.username }).from(users)
      .where(eq(users.isActive, true))
      .orderBy(asc(users.username));
  }
  return db.select({ id: users.id, username: users.username }).from(users)
    .innerJoin(userSites, eq(userSites.userId, users.id))
    .where(and(eq(userSites.siteId, auth.activeSiteId), eq(users.isActive, true)))
    .orderBy(asc(users.username));
}

export async function getGroupDevices() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return [];
  return db.select({ id: devices.id, name: devices.name, rackName: devices.rackName }).from(devices)
    .where(and(eq(devices.siteId, auth.activeSiteId), eq(devices.isActive, true)))
    .orderBy(asc(devices.name));
}

// PIC group picker data for the device edit form: all groups of the active
// site, plus the subset bound to one device (or null when deviceId is absent).
export async function getDeviceGroupOptions(deviceId?: number) {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { groups: [], boundGroupIds: [] as number[] };

  const groups = await db
    .select({ id: deviceGroups.id, name: deviceGroups.name, color: deviceGroups.color })
    .from(deviceGroups)
    .where(and(eq(deviceGroups.siteId, auth.activeSiteId), eq(deviceGroups.isActive, true)))
    .orderBy(asc(deviceGroups.name));

  let boundGroupIds: number[] = [];
  if (deviceId) {
    const rows = await db
      .select({ groupId: devicePics.groupId })
      .from(devicePics)
      .where(eq(devicePics.deviceId, deviceId));
    boundGroupIds = rows.map((r) => r.groupId);
  }

  return { groups, boundGroupIds };
}