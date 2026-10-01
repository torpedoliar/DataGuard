"use server";

import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import { checklistEntries, checklistItems, deviceGroups, devicePics, devices, incidents, networkPorts, siemFindings, vlans } from "../db/schema";
import { requireActiveSiteAction } from "../lib/action-auth";
import type { Severity } from "../lib/rack-signals";

export interface DeviceDrawer {
    picGroups: { name: string; color: string | null }[];
    lastAudit: { checkDate: string; shift: "Pagi" | "Siang" | "Malam"; status: "OK" | "NOT OK"; remarks: string | null; photoPath: string | null } | null;
    incidents: { id: number; title: string; severity: Severity; status: string }[];
    siem: { count: number; latest: { id: number; title: string; severity: Severity }[] };
    connections: { portName: string; portMode: string | null; vlan: number | null; peerDeviceId: number; peerDeviceName: string; peerPortName: string | null }[];
}

// Everything the device drawer shows beyond the layout payload, loaded on
// open. Site-scoped: a device of another site returns null.
export async function getDeviceDrawer(deviceId: number): Promise<DeviceDrawer | null> {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return null;
    const siteId = auth.activeSiteId;

    const [device] = await db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.id, deviceId), eq(devices.siteId, siteId)))
        .limit(1);
    if (!device) return null;

    const peer = alias(devices, "peer");
    const peerPort = alias(networkPorts, "peer_port");
    const openSiem = and(eq(siemFindings.deviceId, deviceId), eq(siemFindings.siteId, siteId), ne(siemFindings.status, "Resolved"));

    const [picGroups, audits, openIncidents, siemCount, siemLatest, connections] = await Promise.all([
        db.select({ name: deviceGroups.name, color: deviceGroups.color })
            .from(devicePics)
            .innerJoin(deviceGroups, eq(devicePics.groupId, deviceGroups.id))
            .where(eq(devicePics.deviceId, deviceId)),
        db.select({
            checkDate: checklistEntries.checkDate,
            shift: checklistEntries.shift,
            status: checklistItems.status,
            remarks: checklistItems.remarks,
            photoPath: checklistItems.photoPath,
        })
            .from(checklistItems)
            .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
            .where(eq(checklistItems.deviceId, deviceId))
            .orderBy(desc(checklistEntries.checkDate), desc(checklistEntries.checkTime))
            .limit(1),
        db.select({ id: incidents.id, title: incidents.title, severity: incidents.severity, status: incidents.status })
            .from(incidents)
            .where(and(eq(incidents.deviceId, deviceId), eq(incidents.siteId, siteId), inArray(incidents.status, ["Open", "In Progress"])))
            .orderBy(desc(incidents.createdAt))
            .limit(10),
        db.select({ count: sql<number>`count(*)::int` }).from(siemFindings).where(openSiem),
        db.select({ id: siemFindings.id, title: siemFindings.title, severity: siemFindings.severity })
            .from(siemFindings)
            .where(openSiem)
            .orderBy(desc(siemFindings.lastSeenAt))
            .limit(3),
        db.select({
            portName: networkPorts.portName,
            portMode: networkPorts.portMode,
            vlan: vlans.vlanId,
            peerDeviceId: peer.id,
            peerDeviceName: peer.name,
            peerPortName: peerPort.portName,
        })
            .from(networkPorts)
            .innerJoin(peer, eq(networkPorts.connectedToDeviceId, peer.id))
            .leftJoin(peerPort, eq(networkPorts.connectedToPortId, peerPort.id))
            .leftJoin(vlans, eq(networkPorts.vlanId, vlans.id))
            .where(and(eq(networkPorts.deviceId, deviceId), eq(peer.siteId, siteId)))
            .orderBy(networkPorts.portName),
    ]);

    return {
        picGroups,
        lastAudit: audits[0] ?? null,
        incidents: openIncidents,
        siem: { count: Number(siemCount[0]?.count ?? 0), latest: siemLatest },
        connections,
    };
}
