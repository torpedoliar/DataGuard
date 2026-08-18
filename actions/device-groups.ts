"use server";

import { db } from "@/db";
import { deviceGroups, devicePics, devices, users } from "@/db/schema";
import { and, eq, inArray, asc, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";

// A PIC group (device_groups) is per-site. Device↔group membership lives in
// device_pics. The responsible owners (PICs) are the group's users, stored in
// users.responsible_for_groups as an array of group ids.

const groupSchema = z.object({
  name: z.string().min(1, "Group name is required"),
  description: z.string().optional(),
  color: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid color hex").default("#3b82f6"),
});

export type DeviceGroupWithPics = Awaited<ReturnType<typeof getDeviceGroups>>[number];

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

  try {
    const [group] = await db.insert(deviceGroups).values({
      siteId: auth.activeSiteId,
      name: parsed.data.name,
      description: parsed.data.description || null,
      color: parsed.data.color,
    }).returning({ id: deviceGroups.id });

    await bindGroup(group.id, auth.activeSiteId, deviceIds, ownerIds);

    revalidatePath("/admin/device-groups");
    revalidatePath("/admin");
    await logAudit({ action: "CREATE", entity: "device_group", entityId: group.id, entityName: parsed.data.name, detail: `${deviceIds.length} devices, ${ownerIds.length} owners` });
    return { success: true, message: "Group created" };
  } catch (e) {
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

  try {
    await db.update(deviceGroups).set({
      name: parsed.data.name ?? existing.name,
      description: parsed.data.description ?? existing.description,
      color: parsed.data.color ?? existing.color,
    }).where(eq(deviceGroups.id, id));

    await bindGroup(id, auth.activeSiteId, deviceIds, ownerIds);

    revalidatePath("/admin/device-groups");
    revalidatePath("/admin");
    await logAudit({ action: "UPDATE", entity: "device_group", entityId: id, entityName: existing.name, detail: `${deviceIds.length} devices, ${ownerIds.length} owners` });
    return { success: true, message: "Group updated" };
  } catch (e) {
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

    await db.delete(deviceGroups).where(eq(deviceGroups.id, id));

    // detach group id from owners
    await detachOwners(id);

    revalidatePath("/admin/device-groups");
    await logAudit({ action: "DELETE", entity: "device_group", entityId: id, entityName: existing.name });
    return { success: true };
  } catch (e) {
    console.error("Delete group error:", e);
    return { message: "Gagal menghapus grup." };
  }
}

// Re-sync device_pics + users.responsible_for_groups for one group.
async function bindGroup(groupId: number, siteId: number, deviceIds: number[], ownerIds: number[]) {
  // device memberships
  await db.delete(devicePics).where(eq(devicePics.groupId, groupId));
  if (deviceIds.length > 0) {
    await db.insert(devicePics).values(deviceIds.map((deviceId) => ({ deviceId, groupId, siteId })));
  }

  // owner assignments: rewrite responsible_for_groups across affected users
  await detachOwners(groupId);
  if (ownerIds.length > 0) {
    const owners = await db.select({ id: users.id, responsibleForGroups: users.responsibleForGroups }).from(users)
      .where(inArray(users.id, ownerIds));
    for (const user of owners) {
      const current = new Set((user.responsibleForGroups ?? []).map(Number));
      current.add(groupId);
      await db.update(users).set({ responsibleForGroups: [...current].map(String) }).where(eq(users.id, user.id));
    }
  }
}

// Remove groupId from every user's responsible_for_groups.
async function detachOwners(groupId: number) {
  const all = await db.select({ id: users.id, responsibleForGroups: users.responsibleForGroups }).from(users);
  for (const user of all) {
    const list = (user.responsibleForGroups ?? []).map(Number).filter((gid) => gid !== groupId);
    if (list.length !== (user.responsibleForGroups ?? []).length) {
      await db.update(users).set({ responsibleForGroups: list.map(String) }).where(eq(users.id, user.id));
    }
  }
}

export type UserForGroup = { id: number; username: string };
export async function getGroupUsers() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return [];
  return db.select({ id: users.id, username: users.username }).from(users).orderBy(asc(users.username));
}

export async function getGroupDevices() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return [];
  return db.select({ id: devices.id, name: devices.name, rackName: devices.rackName }).from(devices)
    .where(eq(devices.siteId, auth.activeSiteId))
    .orderBy(asc(devices.name));
}