import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { devices, vlans, networkPorts, globalSettings } from "../db/schema";
import { getEnv } from "./env";
import { decryptIfEncrypted } from "./crypto";

// ==================== External API types (network-doc) ====================
// Read-only REST API of the switch-config backup app. Response per switch is
// built from the latest successful backup; degraded output is reported in
// parse_warnings (HTTP 200) and must not fail the sync.

const networkDocPortSchema = z.object({
    // name/id may be null on degraded rows — the sync loop skips them with a
    // warning instead of letting one bad port kill the whole batch parse.
    name: z.string().nullish(),
    description: z.string().nullish(),
    enabled: z.boolean().nullish(),
    mode: z.string().nullish(), // "access" | "trunk" | (future modes tolerated)
    native_vlan: z.number().int().nullish(),
    access_vlan: z.number().int().nullish(),
    trunk_allowed_vlans: z.array(z.number().int()).nullish(),
});

const networkDocVlanSchema = z.object({
    id: z.number().int().nullish(), // 802.1Q number
    name: z.string().nullish(),
});

const networkDocSwitchSchema = z.object({
    switch_id: z.number().int().nullish(),
    name: z.string(),
    ip: z.string().nullish(),
    protocol: z.string().optional(),
    hostname: z.string().nullish(),
    source_backup_id: z.number().int().nullish(),
    backup_taken_at: z.string().nullish(),
    vlans: z.array(networkDocVlanSchema).default([]),
    ports: z.array(networkDocPortSchema).default([]),
    parse_warnings: z.array(z.string()).default([]),
});

const networkDocResponseSchema = z.array(networkDocSwitchSchema);

export { networkDocResponseSchema };

export type NetworkDocSwitch = z.infer<typeof networkDocSwitchSchema>;
export type NetworkDocPort = z.infer<typeof networkDocPortSchema>;

export const NETWORK_DOC_TIMEOUT_MS = 10_000;

export async function fetchNetworkDoc(baseUrl: string, apiKey: string): Promise<NetworkDocSwitch[]> {
    const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/network-doc`;
    let response: Response;
    try {
        response = await fetch(url, {
            headers: { "X-API-Key": apiKey, "Accept": "application/json" },
            signal: AbortSignal.timeout(NETWORK_DOC_TIMEOUT_MS),
        });
    } catch (error) {
        // Node's fetch throws a bare "fetch failed" — include the URL so the
        // operator can see which host was unreachable (localhost in Docker is
        // the container itself, not the host).
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Gagal terhubung ke ${url}: ${reason}`);
    }
    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`network-doc API responded ${response.status}: ${body.trim().slice(0, 200)}`);
    }
    const raw: unknown = await response.json();
    // Lenient envelope: the doc shows a bare array; accept { data: [...] } /
    // { switches: [...] } wrappers if the API adds one later.
    const payload = Array.isArray(raw) ? raw : (raw as { data?: unknown; switches?: unknown })?.data ?? (raw as { switches?: unknown })?.switches;
    if (!Array.isArray(payload)) {
        throw new Error("network-doc API returned an unexpected shape (expected an array of switches)");
    }
    return networkDocResponseSchema.parse(payload);
}

// ==================== Config ====================
// Settings are editable from the settings page (global_settings row).
// Environment variables NETWORK_DOC_* still win per-field when set, so a
// deployment can pin values without touching the DB.

export type NetworkDocConfig = {
    url: string | null;
    apiKey: string | null;
    siteId: number | null;
    intervalMs: number | null;
};

export async function resolveNetworkDocConfig(): Promise<NetworkDocConfig> {
    const env = getEnv();

    let stored: {
        networkDocUrl: string | null;
        networkDocApiKey: string | null;
        networkDocSiteId: number | null;
        networkDocIntervalMs: number | null;
    } | null = null;
    try {
        const rows = await db.select({
            networkDocUrl: globalSettings.networkDocUrl,
            networkDocApiKey: globalSettings.networkDocApiKey,
            networkDocSiteId: globalSettings.networkDocSiteId,
            networkDocIntervalMs: globalSettings.networkDocIntervalMs,
        }).from(globalSettings).limit(1);
        stored = rows[0] ?? null;
    } catch {
        // DB unreachable — env values only.
    }

    let apiKey = env.NETWORK_DOC_API_KEY?.trim() || null;
    if (!apiKey && stored?.networkDocApiKey) {
        try {
            apiKey = decryptIfEncrypted(stored.networkDocApiKey);
        } catch {
            apiKey = null;
        }
    }

    const envSiteId = env.NETWORK_DOC_SITE_ID?.trim();
    const envInterval = env.NETWORK_DOC_SYNC_INTERVAL_MS?.trim();

    return {
        url: env.NETWORK_DOC_URL?.trim() || stored?.networkDocUrl?.trim() || null,
        apiKey,
        siteId: envSiteId ? Number(envSiteId) || null : stored?.networkDocSiteId ?? null,
        intervalMs: envInterval ? Number(envInterval) || null : stored?.networkDocIntervalMs ?? null,
    };
}

// ==================== Sync ====================

export type NetworkDocSyncSummary = {
    switchesTotal: number;
    switchesMatched: number;
    switchesUnmatched: number;
    vlansCreated: number;
    vlansUpdated: number;
    portsCreated: number;
    portsUpdated: number;
    warnings: string[];
};

type SiteDevice = { id: number; name: string; assetCode: string | null; ipAddress: string | null };
type SitePort = typeof networkPorts.$inferSelect;

function normalize(value: string | null | undefined): string | null {
    const text = value?.trim().toLowerCase();
    return text || null;
}

function matchDevice(docSwitch: NetworkDocSwitch, siteDevices: SiteDevice[]): SiteDevice | null {
    const ip = docSwitch.ip?.trim();
    if (ip) {
        const byIp = siteDevices.find((d) => d.ipAddress === ip);
        if (byIp) return byIp;
    }
    const name = normalize(docSwitch.name);
    if (name) {
        const byName = siteDevices.find(
            (d) => normalize(d.name) === name || normalize(d.assetCode) === name,
        );
        if (byName) return byName;
    }
    const hostname = normalize(docSwitch.hostname);
    if (hostname) {
        const byHostname = siteDevices.find(
            (d) => normalize(d.name) === hostname || normalize(d.assetCode) === hostname,
        );
        if (byHostname) return byHostname;
    }
    return null;
}

type MappedPortFields = {
    // undefined = the doc did not provide the field → leave the stored value
    // untouched; null = explicitly clear; value = set.
    portMode: "Access" | "Trunk" | null | undefined;
    vlanId: number | null | undefined;
    trunkVlans: string | null | undefined;
    status: "Active" | "Inactive" | undefined;
    description: string | null | undefined;
};

function mapPortFields(port: NetworkDocPort, vlanByNumber: Map<number, number>, warnings: string[]): MappedPortFields {
    let portMode: "Access" | "Trunk" | null | undefined;
    if (port.mode === "access") portMode = "Access";
    else if (port.mode === "trunk") portMode = "Trunk";
    else if (port.mode) {
        portMode = null;
        warnings.push(`port ${port.name}: unknown mode "${port.mode}" → cleared`);
    } else {
        portMode = undefined;
    }

    // Access ports: PVID is access_vlan (native_vlan is usually null); trunk
    // ports: PVID is native_vlan. Unknown modes fall back to either field so
    // a PVID the doc does provide is still mapped. Absent vlan fields leave
    // the stored PVID untouched.
    let vlanNumber: number | null | undefined;
    if (port.mode === "trunk") vlanNumber = port.native_vlan;
    else vlanNumber = port.access_vlan ?? port.native_vlan;

    let vlanId: number | null | undefined;
    if (vlanNumber != null) {
        vlanId = vlanByNumber.get(vlanNumber) ?? null;
        if (vlanId === null) {
            warnings.push(`port ${port.name}: vlan ${vlanNumber} not present on this site → vlanId cleared`);
        }
    } else {
        vlanId = undefined;
    }

    let trunkVlans: string | null | undefined;
    if (port.trunk_allowed_vlans && port.trunk_allowed_vlans.length > 0) {
        trunkVlans = port.trunk_allowed_vlans.join(", ");
    } else if (Array.isArray(port.trunk_allowed_vlans)) {
        trunkVlans = null; // explicit empty list → clear
    } else {
        trunkVlans = undefined;
    }

    let status: "Active" | "Inactive" | undefined;
    if (port.enabled === true) status = "Active";
    else if (port.enabled === false) status = "Inactive";
    else status = undefined;

    let description: string | null | undefined;
    if (port.description === undefined || port.description === null) {
        description = undefined;
    } else {
        description = port.description.trim() || null;
    }

    return { portMode, vlanId, trunkVlans, status, description };
}

export async function syncNetworkDocs(siteId: number): Promise<NetworkDocSyncSummary> {
    const config = await resolveNetworkDocConfig();
    if (!config.url || !config.apiKey) {
        return {
            switchesTotal: 0, switchesMatched: 0, switchesUnmatched: 0,
            vlansCreated: 0, vlansUpdated: 0, portsCreated: 0, portsUpdated: 0,
            warnings: ["Network Docs belum dikonfigurasi (atur di Settings › Network Docs, atau set NETWORK_DOC_URL/NETWORK_DOC_API_KEY) — sync dilewati"],
        };
    }

    const doc = await fetchNetworkDoc(config.url, config.apiKey);

    const summary: NetworkDocSyncSummary = {
        switchesTotal: doc.length,
        switchesMatched: 0,
        switchesUnmatched: 0,
        vlansCreated: 0,
        vlansUpdated: 0,
        portsCreated: 0,
        portsUpdated: 0,
        warnings: [],
    };

    // Load site context in-memory, mirroring actions/network.ts bulk loads.
    const siteDevices: SiteDevice[] = await db
        .select({ id: devices.id, name: devices.name, assetCode: devices.assetCode, ipAddress: devices.ipAddress })
        .from(devices)
        .where(eq(devices.siteId, siteId));

    const siteVlans = await db
        .select({ id: vlans.id, vlanId: vlans.vlanId, name: vlans.name })
        .from(vlans)
        .where(eq(vlans.siteId, siteId));

    const vlanByNumber = new Map<number, number>(); // 802.1Q number → vlans.id
    const vlanNameByNumber = new Map<number, string>(); // latest known name per number
    const vlanCreatedThisRun = new Set<number>();
    for (const v of siteVlans) {
        vlanByNumber.set(v.vlanId, v.id);
        vlanNameByNumber.set(v.vlanId, v.name);
    }

    const siteDeviceIds = siteDevices.map((d) => d.id);
    const sitePorts: SitePort[] = siteDeviceIds.length > 0
        ? await db.select().from(networkPorts).where(inArray(networkPorts.deviceId, siteDeviceIds))
        : [];
    const portsByDevice = new Map<number, SitePort[]>();
    for (const port of sitePorts) {
        const list = portsByDevice.get(port.deviceId) ?? [];
        list.push(port);
        portsByDevice.set(port.deviceId, list);
    }

    // VLANs must exist before ports reference them (networkPorts.vlanId is an
    // FK to vlans.id). Upsert per switch as we go — (siteId, vlanId) has no
    // DB unique index, so this is select-first, never ON CONFLICT.
    const upsertVlan = async (number: number, name: string) => {
        const existingId = vlanByNumber.get(number);
        if (existingId === undefined) {
            const rows = await db.insert(vlans)
                .values({ siteId, vlanId: number, name })
                .returning({ id: vlans.id });
            const newId = rows[0]?.id;
            if (newId === undefined) return;
            vlanByNumber.set(number, newId);
            vlanNameByNumber.set(number, name);
            vlanCreatedThisRun.add(number);
            summary.vlansCreated++;
            return;
        }
        // Skip the update when this run already inserted it with that name,
        // or the name did not actually change.
        if (vlanCreatedThisRun.has(number)) return;
        if (vlanNameByNumber.get(number) === name) return;
        await db.update(vlans).set({ name }).where(eq(vlans.id, existingId));
        vlanNameByNumber.set(number, name);
        summary.vlansUpdated++;
    };

    const seenPorts = new Set<string>(); // deviceId:portName — run-wide, so a
    // switch listed twice (or two switches matching one device) cannot
    // fabricate duplicate port rows.
    for (const docSwitch of doc) {
        const device = matchDevice(docSwitch, siteDevices);
        if (!device) {
            summary.switchesUnmatched++;
            summary.warnings.push(
                `switch "${docSwitch.name}" (ip=${docSwitch.ip ?? "-"}) not matched to a device in site ${siteId}`,
            );
            continue;
        }
        summary.switchesMatched++;

        // VLANs are site-wide in dc-check but the API returns every backed-up
        // switch, so only upsert VLANs of switches that actually match this
        // site — foreign switches would pollute the site's VLAN table.
        for (const docVlan of docSwitch.vlans) {
            if (docVlan.id == null) {
                summary.warnings.push(`switch ${docSwitch.name}: vlan tanpa nomor di-skip`);
                continue;
            }
            // The API can emit null vlan names on degraded switches; dc-check
            // requires a name, so fall back to an explicit label.
            await upsertVlan(docVlan.id, docVlan.name?.trim() || `VLAN ${docVlan.id}`);
        }

        const existingPorts = portsByDevice.get(device.id) ?? [];
        for (const docPort of docSwitch.ports) {
            if (!docPort.name) {
                summary.warnings.push(`device ${device.name}: port tanpa nama di-skip`);
                continue;
            }
            const portKey = `${device.id}:${docPort.name}`;
            if (seenPorts.has(portKey)) {
                summary.warnings.push(`device ${device.name}: duplicate port "${docPort.name}" in doc — skipped`);
                continue;
            }
            seenPorts.add(portKey);

            const existing = existingPorts.find((p) => p.portName === docPort.name);
            if (existing && existingPorts.filter((p) => p.portName === docPort.name).length > 1) {
                summary.warnings.push(
                    `device ${device.name} port "${docPort.name}" has duplicate rows in dc-check — updated first match`,
                );
            }

            const mapped = mapPortFields(docPort, vlanByNumber, summary.warnings);

            if (!existing) {
                await db.insert(networkPorts).values({
                    deviceId: device.id,
                    portName: docPort.name,
                    portMode: mapped.portMode ?? null,
                    vlanId: mapped.vlanId ?? null,
                    trunkVlans: mapped.trunkVlans ?? null,
                    status: mapped.status ?? "Active",
                    description: mapped.description ?? null,
                });
                summary.portsCreated++;
                continue;
            }

            // Update only the API-provided fields; cabling/faceplate/MAC/speed/
            // connectedTo*/portIndex stay untouched. Fields the doc omits
            // (undefined) leave the stored value alone. Skip when nothing changed.
            const update: Partial<typeof networkPorts.$inferInsert> = {};
            if (mapped.portMode !== undefined && existing.portMode !== mapped.portMode) update.portMode = mapped.portMode ?? null;
            if (mapped.vlanId !== undefined && existing.vlanId !== mapped.vlanId) update.vlanId = mapped.vlanId;
            if (mapped.trunkVlans !== undefined && existing.trunkVlans !== mapped.trunkVlans) update.trunkVlans = mapped.trunkVlans;
            if (mapped.status !== undefined && existing.status !== mapped.status) update.status = mapped.status;
            if (mapped.description !== undefined && (existing.description ?? null) !== mapped.description) update.description = mapped.description;
            if (Object.keys(update).length > 0) {
                await db.update(networkPorts).set(update).where(eq(networkPorts.id, existing.id));
                summary.portsUpdated++;
            }
        }
    }

    return summary;
}
