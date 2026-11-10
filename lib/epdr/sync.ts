/**
 * Endpoint inventory + protection-status sync (T03).
 *
 * Purely orchestrated: the HTTP paging comes from injected async iterators and
 * every DB side effect goes through an injected `deps`, so tests run the full
 * merge/removal/lock logic without Postgres or live network. A partial fetch
 * (any page throws) never marks endpoints removed; removal happens only on a
 * complete successful fetch when a previously-synced device id is absent.
 */

export type EndpointSourceDevice = {
  device_id?: string;
  host_name?: string;
  ip_address?: string;
  mac_addresses?: unknown;
  platform_id?: number;
  operating_system?: string;
  device_type?: number;
  agent_version?: string;
  group_path?: string;
  last_connection?: string;
  security_configuration_id?: string;
  security_configuration_name?: string;
  isolation_state?: number;
  license_status?: number;
  encryption?: unknown;
};

export type EndpointSourceProtection = {
  device_id?: string;
  accumulated_protection_status?: number;
  adaptive_defense_status?: number;
  file_antivirus_status?: number;
  firewall_status?: number;
  protection_engine_update_status?: number;
  protection_engine_version?: string;
  knowledge_catalog_update_status?: number;
  knowledge_catalog_date?: string;
  reboot_requested?: boolean;
  reinstall_protection_requested?: boolean;
  reinstall_agent_requested?: boolean;
  reinstall_protection_error?: unknown;
  reinstall_agent_error?: unknown;
};

export type EndpointSourceUnmanaged = {
  wg_unmanaged_id?: string;
  host_name?: string;
  ip_address?: string;
  mac_address?: string;
  status?: number;
  installation_error?: string;
  last_seen?: string;
};

export type MergedEndpoint = {
  wgDeviceId: string;
  hostName: string;
  ipAddress: string | null;
  macAddresses: unknown;
  platformId: number | null;
  operatingSystem: string | null;
  deviceType: number | null;
  agentVersion: string | null;
  groupPath: string | null;
  securityConfigurationId: string | null;
  securityConfigurationName: string | null;
  isolationState: number | null;
  licenseStatus: number | null;
  encryption: unknown;
  lastConnectionAt: Date | null;
  accumulatedProtectionStatus: number | null;
  adaptiveDefenseStatus: number | null;
  fileAntivirusStatus: number | null;
  firewallStatus: number | null;
  protectionEngineUpdateStatus: number | null;
  protectionEngineVersion: string | null;
  knowledgeCatalogUpdateStatus: number | null;
  knowledgeCatalogDate: Date | null;
  rebootRequested: boolean | null;
  reinstallProtectionRequested: boolean | null;
  reinstallAgentRequested: boolean | null;
  reinstallProtectionError: unknown;
  reinstallAgentError: unknown;
  raw: unknown;
};

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Merge device rows and protection rows by provider device_id (pure). */
export function mergeEndpoints(
  devices: EndpointSourceDevice[],
  protections: EndpointSourceProtection[],
): MergedEndpoint[] {
  const protectionByDevice = new Map<string, EndpointSourceProtection>();
  for (const p of protections) {
    if (p.device_id) protectionByDevice.set(p.device_id, p);
  }

  const merged: MergedEndpoint[] = [];
  for (const d of devices) {
    const id = d.device_id;
    if (!id) continue;
    const p = protectionByDevice.get(id);
    const hostName = d.host_name ?? p?.device_id ?? id;

    merged.push({
      wgDeviceId: id,
      hostName,
      ipAddress: d.ip_address ?? null,
      macAddresses: d.mac_addresses ?? null,
      platformId: d.platform_id ?? null,
      operatingSystem: d.operating_system ?? null,
      deviceType: d.device_type ?? null,
      agentVersion: d.agent_version ?? null,
      groupPath: d.group_path ?? null,
      securityConfigurationId: d.security_configuration_id ?? null,
      securityConfigurationName: d.security_configuration_name ?? null,
      isolationState: d.isolation_state ?? null,
      licenseStatus: d.license_status ?? null,
      encryption: d.encryption ?? null,
      lastConnectionAt: parseDate(d.last_connection),
      accumulatedProtectionStatus: p?.accumulated_protection_status ?? null,
      adaptiveDefenseStatus: p?.adaptive_defense_status ?? null,
      fileAntivirusStatus: p?.file_antivirus_status ?? null,
      firewallStatus: p?.firewall_status ?? null,
      protectionEngineUpdateStatus: p?.protection_engine_update_status ?? null,
      protectionEngineVersion: p?.protection_engine_version ?? null,
      knowledgeCatalogUpdateStatus: p?.knowledge_catalog_update_status ?? null,
      knowledgeCatalogDate: parseDate(p?.knowledge_catalog_date),
      rebootRequested: p?.reboot_requested ?? null,
      reinstallProtectionRequested: p?.reinstall_protection_requested ?? null,
      reinstallAgentRequested: p?.reinstall_agent_requested ?? null,
      reinstallProtectionError: p?.reinstall_protection_error ?? null,
      reinstallAgentError: p?.reinstall_agent_error ?? null,
      raw: { device: d, protection: p ?? null },
    });
  }
  return merged;
}

export type SyncSummary = {
  status: "ok" | "partial" | "failed" | "skipped_locked";
  seen: number;
  upserted: number;
  removed: number;
  unmanaged: number;
  error?: string;
};

export type EndpointSyncDeps = {
  connectionId: number;
  siteId: number;
  tryAcquireLock(connectionId: number): Promise<boolean>;
  releaseLock(connectionId: number): Promise<void>;
  iterateDevices(): AsyncIterable<EndpointSourceDevice>;
  iterateProtectionStatus(): AsyncIterable<EndpointSourceProtection>;
  listUnmanagedDevices(): Promise<EndpointSourceUnmanaged[]>;
  existingDeviceIds(connectionId: number): Promise<Set<string>>;
  upsertEndpoint(connectionId: number, siteId: number, merged: MergedEndpoint): Promise<void>;
  markRemoved(connectionId: number, absentIds: string[]): Promise<number>;
  upsertUnmanaged(connectionId: number, siteId: number, items: EndpointSourceUnmanaged[]): Promise<number>;
  recordSyncRun(kind: "endpoints", status: "ok" | "partial" | "failed", stats: unknown, error?: string): Promise<void>;
  touchConnection(connectionId: number, error?: string): Promise<void>;
};

export async function syncEndpoints(deps: EndpointSyncDeps): Promise<SyncSummary> {
  const acquired = await deps.tryAcquireLock(deps.connectionId);
  if (!acquired) {
    return { status: "skipped_locked", seen: 0, upserted: 0, removed: 0, unmanaged: 0 };
  }

  try {
    const devices: EndpointSourceDevice[] = [];
    const protections: EndpointSourceProtection[] = [];
    let unmanaged: EndpointSourceUnmanaged[] = [];
    let partial = false;

    try {
      for await (const d of deps.iterateDevices()) devices.push(d);
    } catch {
      partial = true;
    }
    try {
      for await (const p of deps.iterateProtectionStatus()) protections.push(p);
    } catch {
      partial = true;
    }

    const merged = mergeEndpoints(devices, protections);

    let upserted = 0;
    const seenIds = new Set<string>();
    for (const item of merged) {
      seenIds.add(item.wgDeviceId);
      await deps.upsertEndpoint(deps.connectionId, deps.siteId, item);
      upserted++;
    }

    // Removal only on a complete fetch; a partial run preserves stale rows.
    let removed = 0;
    if (!partial) {
      const existing = await deps.existingDeviceIds(deps.connectionId);
      const absent = [...existing].filter((id) => !seenIds.has(id));
      if (absent.length > 0) removed = await deps.markRemoved(deps.connectionId, absent);
    }

    // Unmanaged devices are a separate inventory (best-effort, page-safely).
    let unmanagedCount = 0;
    try {
      unmanaged = await deps.listUnmanagedDevices();
      unmanagedCount = await deps.upsertUnmanaged(deps.connectionId, deps.siteId, unmanaged);
    } catch {
      partial = true;
    }

    const status = partial ? "partial" : "ok";
    await deps.recordSyncRun("endpoints", status, { seen: upserted, removed, unmanaged: unmanagedCount });
    await deps.touchConnection(deps.connectionId, partial ? "partial fetch" : undefined);

    return { status, seen: merged.length, upserted, removed, unmanaged: unmanagedCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.recordSyncRun("endpoints", "failed", {}, message).catch(() => undefined);
    await deps.touchConnection(deps.connectionId, message).catch(() => undefined);
    return { status: "failed", seen: 0, upserted: 0, removed: 0, unmanaged: 0, error: message };
  } finally {
    await deps.releaseLock(deps.connectionId);
  }
}