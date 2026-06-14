"use server";

import { db } from "@/db";
import { vlans, networkPorts, devices } from "@/db/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { requireActiveSiteAction, requireActiveSiteAdminAction } from "@/lib/action-auth";
import * as XLSX from "xlsx";
import { PORT_IMPORT_COLUMNS, parseNetworkPortImportRows } from "@/lib/network-port-import";

// --- VLAN ACTIONS ---

export async function getVlans() {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return [];

    return await db.select().from(vlans).where(eq(vlans.siteId, auth.activeSiteId)).orderBy(vlans.vlanId);
}

export async function addVlan(data: { vlanId: number, name: string, subnet?: string, description?: string }) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) throw new Error(auth.message);

    try {
        await db.insert(vlans).values({
            siteId: auth.activeSiteId,
            vlanId: data.vlanId,
            name: data.name,
            subnet: data.subnet || null,
            description: data.description || null,
        });
        await logAudit({ action: "CREATE", entity: "vlan", entityName: data.name, detail: `ID: ${data.vlanId}, Subnet: ${data.subnet || '-'}` });
    } catch (error: unknown) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
            throw new Error("Nomor VLAN ID ini sudah digunakan. Silakan masukkan ID lain.");
        }
        throw new Error("Gagal menyimpan VLAN ke database. Silakan coba lagi.");
    }

    revalidatePath("/admin/network");
}

export async function updateVlan(id: number, data: { name: string, subnet?: string, description?: string }) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) throw new Error(auth.message);

    try {
        await db.update(vlans)
            .set({
                name: data.name,
                subnet: data.subnet || null,
                description: data.description || null,
            })
            .where(and(eq(vlans.id, id), eq(vlans.siteId, auth.activeSiteId)));
        await logAudit({ action: "UPDATE", entity: "vlan", entityId: id, entityName: data.name, detail: `Subnet: ${data.subnet || '-'}` });
    } catch (error) {
        throw new Error("Gagal memperbarui VLAN. Silakan coba lagi nanti.");
    }

    revalidatePath("/admin/network");
}

export async function deleteVlan(id: number) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) throw new Error(auth.message);

    try {
        await db.delete(vlans).where(and(eq(vlans.id, id), eq(vlans.siteId, auth.activeSiteId)));
        await logAudit({ action: "DELETE", entity: "vlan", entityId: id });
        revalidatePath("/admin/network");
    } catch (error) {
        throw new Error("Gagal menghapus VLAN. Mungkin masih digunakan oleh port jaringan.");
    }
}

// --- PORT ACTIONS ---

export async function getPortsByDevice(deviceId: number) {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return [];

    const [device] = await db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.id, deviceId), eq(devices.siteId, auth.activeSiteId)))
        .limit(1);

    if (!device) return [];

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
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) throw new Error(auth.message);

    const [device] = await db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.id, data.deviceId), eq(devices.siteId, auth.activeSiteId)))
        .limit(1);

    if (!device) throw new Error("Perangkat tidak ditemukan di site aktif.");

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
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) throw new Error(auth.message);

    if (ports.length === 0) return;

    const deviceId = ports[0].deviceId;
    if (ports.some((port) => port.deviceId !== deviceId)) throw new Error("Semua port bulk harus untuk device yang sama.");

    const [device] = await db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.id, deviceId), eq(devices.siteId, auth.activeSiteId)))
        .limit(1);

    if (!device) throw new Error("Perangkat tidak ditemukan di site aktif.");

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

export async function downloadPortImportTemplate(deviceId: number) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) throw new Error(auth.message);

    const [device] = await db
        .select({ id: devices.id, name: devices.name })
        .from(devices)
        .where(and(eq(devices.id, deviceId), eq(devices.siteId, auth.activeSiteId)))
        .limit(1);

    if (!device) throw new Error("Perangkat tidak ditemukan di site aktif.");

    const siteVlans = await db
        .select({ id: vlans.id, vlanId: vlans.vlanId, name: vlans.name })
        .from(vlans)
        .where(eq(vlans.siteId, auth.activeSiteId))
        .orderBy(vlans.vlanId);

    const workbook = XLSX.utils.book_new();
    const portsSheet = XLSX.utils.json_to_sheet([
        {
            "Port Name": "Gi1/0/1",
            "MAC Address": "",
            "IP Address": "",
            "Port Mode": "Access",
            "VLAN ID": siteVlans[0]?.vlanId ?? "",
            "Allowed Trunk VLANs": "",
            Status: "Active",
            Speed: "1G",
            "Media Type": "Copper (RJ45)",
            Description: `Port ${device.name}`,
        },
        {
            "Port Name": "Te1/0/1",
            "MAC Address": "",
            "IP Address": "",
            "Port Mode": "Trunk",
            "VLAN ID": "",
            "Allowed Trunk VLANs": "10,20,100-200",
            Status: "Active",
            Speed: "10G",
            "Media Type": "Fiber (SFP/SFP+)",
            Description: "Uplink",
        },
    ], { header: [...PORT_IMPORT_COLUMNS] });
    const referenceSheet = XLSX.utils.json_to_sheet([
        { Field: "Port Mode", AllowedValues: "Access, Trunk, Routed, LACP" },
        { Field: "Status", AllowedValues: "Active, Inactive, Down" },
        { Field: "Speed", AllowedValues: "10/100M, 1G, 10G, 25G, 40G, 100G, Auto" },
        { Field: "Media Type", AllowedValues: "Copper (RJ45), Fiber (SFP/SFP+), Twinax (DAC)" },
        ...siteVlans.map((vlan) => ({ Field: "VLAN ID", AllowedValues: `${vlan.vlanId} - ${vlan.name}` })),
    ]);

    XLSX.utils.book_append_sheet(workbook, portsSheet, "Ports");
    XLSX.utils.book_append_sheet(workbook, referenceSheet, "Reference");
    return XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
}

export type PortImportResult = {
  success: boolean;
  inserted: number;
  errors: string[];
  message?: string;
};

export async function importPortsFromFile(
  deviceId: number,
  formData: FormData,
): Promise<PortImportResult> {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) {
    return { success: false, inserted: 0, errors: [auth.message] };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, inserted: 0, errors: ["Empty file"] };
  }

  const [device] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.siteId, auth.activeSiteId)))
    .limit(1);

  if (!device) {
    return { success: false, inserted: 0, errors: ["Perangkat tidak ditemukan di site aktif."] };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = file.name.toLowerCase();

  let rows: Record<string, unknown>[];
  try {
    if (fileName.endsWith(".csv") || file.type === "text/csv") {
      const text = buffer.toString("utf8");
      const workbook = XLSX.read(text, { type: "string" });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) {
        return { success: false, inserted: 0, errors: ["Empty file"] };
      }
      rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], { defval: "" });
    } else {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const worksheet = workbook.Sheets.Ports ?? workbook.Sheets[workbook.SheetNames[0]];
      if (!worksheet) {
        return { success: false, inserted: 0, errors: ["Sheet 'Ports' not found in import file."] };
      }
      rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
    }
  } catch (error) {
    return {
      success: false,
      inserted: 0,
      errors: [`Failed to parse file: ${error instanceof Error ? error.message : "unknown error"}`],
    };
  }

  if (rows.length === 0) {
    return { success: false, inserted: 0, errors: ["Empty file"] };
  }

  if (rows.length > 500) {
    return { success: false, inserted: 0, errors: ["Maksimum 500 port bisa diimport dalam satu file."] };
  }

  const [siteVlans, existingPorts] = await Promise.all([
    db
      .select({ id: vlans.id, vlanId: vlans.vlanId, name: vlans.name })
      .from(vlans)
      .where(eq(vlans.siteId, auth.activeSiteId)),
    db
      .select({ portName: networkPorts.portName })
      .from(networkPorts)
      .where(eq(networkPorts.deviceId, deviceId)),
  ]);

  const parsed = parseNetworkPortImportRows(rows, {
    deviceId,
    vlanRefs: siteVlans,
    existingPortNames: existingPorts.map((port) => port.portName),
  });

  if (parsed.errors.length > 0) {
    return { success: false, inserted: 0, errors: parsed.errors };
  }

  try {
    await db.insert(networkPorts).values(parsed.ports);
    await logAudit({
      action: "CREATE",
      entity: "network_port",
      entityName: `Import (${parsed.ports.length} ports)`,
      detail: `DeviceID: ${deviceId}`,
    });
  } catch (error) {
    return {
      success: false,
      inserted: 0,
      errors: [
        `Failed to insert ports: ${error instanceof Error ? error.message : "unknown error"}`,
      ],
    };
  }

  revalidatePath("/admin/network");
  revalidatePath(`/admin/devices/${deviceId}/network`);

  return {
    success: true,
    inserted: parsed.ports.length,
    errors: [],
    message: `${parsed.ports.length} ports imported successfully.`,
  };
}

export async function importPortsFromXlsx(deviceId: number, base64Xlsx: string) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) throw new Error(auth.message);

    const [device] = await db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.id, deviceId), eq(devices.siteId, auth.activeSiteId)))
        .limit(1);

    if (!device) throw new Error("Perangkat tidak ditemukan di site aktif.");

    const workbook = XLSX.read(base64Xlsx, { type: "base64" });
    const worksheet = workbook.Sheets.Ports;
    if (!worksheet) throw new Error("Sheet 'Ports' tidak ditemukan di file import.");

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
    if (rows.length > 500) throw new Error("Maksimum 500 port bisa diimport dalam satu file.");

    const siteVlans = await db
        .select({ id: vlans.id, vlanId: vlans.vlanId, name: vlans.name })
        .from(vlans)
        .where(eq(vlans.siteId, auth.activeSiteId));
    const existingPorts = await db
        .select({ portName: networkPorts.portName })
        .from(networkPorts)
        .where(eq(networkPorts.deviceId, deviceId));

    const parsed = parseNetworkPortImportRows(rows, {
        deviceId,
        vlanRefs: siteVlans,
        existingPortNames: existingPorts.map((port) => port.portName),
    });

    if (parsed.errors.length > 0) throw new Error(parsed.errors.slice(0, 10).join("\n"));

    await bulkAddPorts(parsed.ports);
    return { imported: parsed.ports.length };
}
export async function updatePort(id: number, data: Partial<typeof networkPorts.$inferInsert>) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) throw new Error(auth.message);

    try {
        // Get current port info for bidirectional cleanup if connection changed
        const currentPort = await db
            .select({
                id: networkPorts.id,
                deviceId: networkPorts.deviceId,
                connectedToPortId: networkPorts.connectedToPortId,
            })
            .from(networkPorts)
            .innerJoin(devices, eq(networkPorts.deviceId, devices.id))
            .where(and(eq(networkPorts.id, id), eq(devices.siteId, auth.activeSiteId)))
            .limit(1);

        if (currentPort.length === 0) throw new Error("Port tidak ditemukan di site aktif.");

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
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) throw new Error(auth.message);

    try {
        // Clean up bidirectional links first
        const port = await db
            .select({
                id: networkPorts.id,
                connectedToPortId: networkPorts.connectedToPortId,
            })
            .from(networkPorts)
            .innerJoin(devices, eq(networkPorts.deviceId, devices.id))
            .where(and(eq(networkPorts.id, id), eq(devices.siteId, auth.activeSiteId)))
            .limit(1);

        if (port.length === 0) throw new Error("Port tidak ditemukan di site aktif.");
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


