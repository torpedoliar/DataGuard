"use server";

import { db } from "@/db";
import { vlans, networkPorts, devices } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { verifySession } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";

// --- VLAN ACTIONS ---

export async function getVlans() {
    const session = await verifySession();
    if (!session) return [];

    const siteFilter = session.activeSiteId ? eq(vlans.siteId, session.activeSiteId) : undefined;
    return await db.select().from(vlans).where(siteFilter).orderBy(vlans.vlanId);
}

export async function addVlan(data: { vlanId: number, name: string, subnet?: string, description?: string }) {
    const session = await verifySession();
    if (!session) throw new Error("Anda tidak memiliki hak akses (Unauthorized).");

    try {
        await db.insert(vlans).values({
            siteId: session.activeSiteId,
            vlanId: data.vlanId,
            name: data.name,
            subnet: data.subnet || null,
            description: data.description || null,
        });
        await logAudit({ action: "CREATE", entity: "vlan", entityName: data.name, detail: `ID: ${data.vlanId}, Subnet: ${data.subnet || '-'}` });
    } catch (error: any) {
        if (error?.message?.includes("UNIQUE constraint")) {
            throw new Error("Nomor VLAN ID ini sudah digunakan. Silakan masukkan ID lain.");
        }
        throw new Error("Gagal menyimpan VLAN ke database. Silakan coba lagi.");
    }

    revalidatePath("/admin/network");
}

export async function updateVlan(id: number, data: { name: string, subnet?: string, description?: string }) {
    const session = await verifySession();
    if (!session) throw new Error("Anda tidak memiliki hak akses (Unauthorized).");

    try {
        await db.update(vlans)
            .set({
                name: data.name,
                subnet: data.subnet || null,
                description: data.description || null,
            })
            .where(eq(vlans.id, id));
        await logAudit({ action: "UPDATE", entity: "vlan", entityId: id, entityName: data.name, detail: `Subnet: ${data.subnet || '-'}` });
    } catch (error) {
        throw new Error("Gagal memperbarui VLAN. Silakan coba lagi nanti.");
    }

    revalidatePath("/admin/network");
}

export async function deleteVlan(id: number) {
    const session = await verifySession();
    if (!session) throw new Error("Anda tidak memiliki hak akses (Unauthorized).");

    try {
        await db.delete(vlans).where(eq(vlans.id, id));
        await logAudit({ action: "DELETE", entity: "vlan", entityId: id });
        revalidatePath("/admin/network");
    } catch (error) {
        throw new Error("Gagal menghapus VLAN. Mungkin masih digunakan oleh port jaringan.");
    }
}

// --- PORT ACTIONS ---

export async function getPortsByDevice(deviceId: number) {
    const session = await verifySession();
    if (!session) return [];

    return await db.select({
        id: networkPorts.id,
        deviceId: networkPorts.deviceId,
        portName: networkPorts.portName,
        macAddress: networkPorts.macAddress,
        ipAddress: networkPorts.ipAddress,
        portMode: networkPorts.portMode,
        vlanId: networkPorts.vlanId,
        vlanName: vlans.name,
        vlanNumber: vlans.vlanId,
        trunkVlans: networkPorts.trunkVlans,
        status: networkPorts.status,
        speed: networkPorts.speed,
        mediaType: networkPorts.mediaType,
        connectedToDeviceId: networkPorts.connectedToDeviceId,
        connectedToDeviceName: devices.name,
        connectedToPortId: networkPorts.connectedToPortId,
        connectedToPortName: sql<string>`connectedPort.port_name`,
        description: networkPorts.description,
    })
        .from(networkPorts)
        .leftJoin(vlans, eq(networkPorts.vlanId, vlans.id))
        .leftJoin(devices, eq(networkPorts.connectedToDeviceId, devices.id))
        .leftJoin(sql`network_ports as connectedPort`, eq(networkPorts.connectedToPortId, sql`connectedPort.id`))
        .where(eq(networkPorts.deviceId, deviceId))
        .orderBy(networkPorts.portName);
}

export async function addPort(data: typeof networkPorts.$inferInsert) {
    const session = await verifySession();
    if (!session) throw new Error("Anda tidak memiliki hak akses (Unauthorized).");

    try {
        await db.insert(networkPorts).values(data);

        // Attempt bidirectional connection if connectedToPortId is provided
        if (data.connectedToPortId) {
            // Fetch new port ID
            const newlyInserted = await db.select({ id: networkPorts.id })
                .from(networkPorts)
                .where(eq(networkPorts.deviceId, data.deviceId))
                .orderBy(desc(networkPorts.id))
                .limit(1);

            if (newlyInserted.length > 0) {
                await db.update(networkPorts)
                    .set({
                        connectedToDeviceId: data.deviceId,
                        connectedToPortId: newlyInserted[0].id
                    })
                    .where(eq(networkPorts.id, data.connectedToPortId));
            }
        }
        await logAudit({ action: "CREATE", entity: "network_port", entityName: data.portName, detail: `DeviceID: ${data.deviceId}, Mode: ${data.portMode || '-'}` });
    } catch (error) {
        throw new Error("Gagal menyimpan port jaringan baru. Pastikan koneksi server stabil.");
    }

    revalidatePath("/admin/network");
    revalidatePath(`/admin/devices/${data.deviceId}/network`);
}

export async function bulkAddPorts(ports: (typeof networkPorts.$inferInsert)[]) {
    const session = await verifySession();
    if (!session) throw new Error("Anda tidak memiliki hak akses (Unauthorized).");

    if (ports.length === 0) return;

    const deviceId = ports[0].deviceId;

    try {
        await db.insert(networkPorts).values(ports);
        await logAudit({
            action: "CREATE",
            entity: "network_port",
            entityName: `Bulk (${ports.length} ports)`,
            detail: `DeviceID: ${deviceId}, Ports: ${ports[0].portName}...${ports[ports.length - 1].portName}`
        });
    } catch (error) {
        throw new Error("Gagal menyimpan daftar port jaringan. Silakan periksa duplikasi nama port.");
    }

    revalidatePath("/admin/network");
    revalidatePath(`/admin/devices/${deviceId}/network`);
}

export async function updatePort(id: number, data: Partial<typeof networkPorts.$inferInsert>) {
    const session = await verifySession();
    if (!session) throw new Error("Anda tidak memiliki hak akses (Unauthorized).");

    try {
        // Get current port info for bidirectional cleanup if connection changed
        const currentPort = await db.select().from(networkPorts).where(eq(networkPorts.id, id)).limit(1);

        await db.update(networkPorts).set(data).where(eq(networkPorts.id, id));

        // Handle Bidirectional cable disconnects/reconnects
        if (currentPort.length > 0) {
            const oldConn = currentPort[0].connectedToPortId;
            const newConn = data.connectedToPortId;

            if (oldConn !== newConn) {
                // Unlink old
                if (oldConn) {
                    await db.update(networkPorts).set({ connectedToDeviceId: null, connectedToPortId: null }).where(eq(networkPorts.id, oldConn));
                }
                // Link new
                if (newConn && data.deviceId) {
                    await db.update(networkPorts).set({ connectedToDeviceId: data.deviceId, connectedToPortId: id }).where(eq(networkPorts.id, newConn));
                }
            }
        }
        await logAudit({ action: "UPDATE", entity: "network_port", entityId: id, entityName: data.portName, detail: `DeviceID: ${data.deviceId || '-'}` });
    } catch (error) {
        throw new Error("Gagal memperbarui konfigurasi port jaringan. Silakan ulangi.");
    }

    revalidatePath("/admin/network");
}

export async function deletePort(id: number) {
    const session = await verifySession();
    if (!session) throw new Error("Anda tidak memiliki hak akses (Unauthorized).");

    try {
        // Clean up bidirectional links first
        const port = await db.select().from(networkPorts).where(eq(networkPorts.id, id)).limit(1);
        if (port.length > 0 && port[0].connectedToPortId) {
            await db.update(networkPorts)
                .set({ connectedToDeviceId: null, connectedToPortId: null })
                .where(eq(networkPorts.id, port[0].connectedToPortId));
        }

        await db.delete(networkPorts).where(eq(networkPorts.id, id));
        await logAudit({ action: "DELETE", entity: "network_port", entityId: id });
    } catch (error) {
        throw new Error("Gagal menghapus port jaringan secara permanen.");
    }
    revalidatePath("/admin/network");
}
