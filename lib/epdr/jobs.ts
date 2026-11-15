/**
 * EPDR worker job registry + the DB/HTTP wiring for each registered job.
 *
 * The pure sync/ingest/policy/action logic lives in `lib/epdr/*.ts` and is
 * tested with injected deps; here each job resolves the connection's read-only
 * credentials, builds a read-only client, and wires those pure functions to
 * the real DB. Under the read-only lock the client only performs allowlisted
 * reads + OAuth token; dispatch/scan/action jobs are registered once their
 * tickets land and remain blocked by the transport guard.
 */
import { Client } from "pg";
import { and, desc, eq, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { devices, epdrActions, epdrDetections, epdrLocalNotificationPolicies, epdrEndpoints, epdrExclusions, epdrHealthCases, epdrRuleEvaluations, epdrRules, epdrSiteSettings, epdrSyncRuns, epdrUnmanagedDevices, epdrWorkflows, incidents, watchguardConnections, watchguardGlobalSettings } from "@/db/schema";
import { buildDatabaseUrl } from "@/lib/database-url";
import { resolveWatchGuardConnection } from "@/lib/watchguard/connection";
import { createWatchGuardClient } from "@/lib/watchguard/client";
import { syncEndpoints, type EndpointSyncDeps, type EndpointSourceDevice, type EndpointSourceProtection, type EndpointSourceUnmanaged } from "./sync";
import { buildSecurityEventDetections, buildThreatSyncDetections, md5ThreatKeySuffix, threatKeyFor, type DetectionDraft, type IgnoredItem } from "./detect-ingest";
import { attachDetectionOnce } from "./detection-attachment";
import { epdrDetectionReadEvidence } from "@/db/schema";
import { eventExportReadStatus, type DetectionReadEvidence } from "./detection-evidence";
import { correlate } from "./correlation";
import { evaluate as evaluatePolicy, type EndpointInput as PolicyEndpoint, type RuleInput as PolicyRule, type SiteControls, type GlobalControls } from "./policy";
import { classifyHealth, advanceHealthStage, type HealthSettings } from "./health";
import { resolveConnectionState } from "./posture";
import type { IngestSettings } from "./detect-ingest";
import { assertReadSyncActor, processReadSyncQueue, type ReadSyncFence } from "./read-sync-queue";
import { processLocalNotificationQueue, scheduleLocalNotifications } from "./local-notification-outbox";
import { calculateIncidentDueDate } from "@/lib/incidents";

export async function runPendingReadSyncRequests(): Promise<void> {
  await processReadSyncQueue(runEndpointsJob);
}

/**
 * Local in-app notifications only. Scheduling is bounded to sites with an
 * explicitly enabled policy; delivery is assignee-scoped and never leaves the
 * application. No external channel exists in this path.
 */
export async function runLocalNotificationPass(): Promise<void> {
  const policies = await db
    .select({ siteId: epdrLocalNotificationPolicies.siteId })
    .from(epdrLocalNotificationPolicies)
    .where(eq(epdrLocalNotificationPolicies.enabled, true));
  for (const { siteId } of policies) {
    try {
      await scheduleLocalNotifications(siteId);
    } catch {
      // A broken site must not starve the others; no raw error content is logged.
      console.error("[epdr] local notification scheduling failed");
    }
  }
  await processLocalNotificationQueue();
}

export type EpdrJobName = "endpoints" | "detections" | "evaluate" | "dispatch" | "tasks" | "provider_sync" | "verify" | "health";

export type EpdrJob = {
  name: EpdrJobName;
  run(connectionId: number): Promise<void>;
};

/** Bounded advisory lock held on a dedicated client for the duration of a run. */
async function acquireAdvisoryLock(key: number): Promise<(() => Promise<void>) | null> {
  let client: Client | null = null;
  try {
    client = new Client({ connectionString: buildDatabaseUrl() });
    await client.connect();
    const res = await client.query<{ pg_try_advisory_lock: boolean }>("SELECT pg_try_advisory_lock($1)", [key]);
    if (res.rows[0]?.pg_try_advisory_lock !== true) {
      await client.end();
      return null;
    }
    return async () => {
      await client!.query("SELECT pg_advisory_unlock($1)", [key]).catch(() => undefined);
      await client!.end();
    };
  } catch {
    await client?.end().catch(() => undefined);
    throw new Error("advisory_lock_unavailable");
  }
}

function endpointSyncDeps(
  connectionId: number,
  siteId: number,
  creds: Parameters<typeof createWatchGuardClient>[0],
  credentialRevision: number,
  accountRevision: number,
  fence?: ReadSyncFence,
): EndpointSyncDeps {
  // Each publication locks the binding in the same transaction as the write.
  // Settings changes therefore cannot interleave a revision check and its write.
  async function publish<T>(write: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      const { rows } = await tx.execute(sql`SELECT id FROM watchguard_connections
        WHERE id = ${connectionId} AND site_id = ${siteId} AND enabled
        AND account_revision = ${accountRevision} AND credential_revision = ${credentialRevision} FOR UPDATE`);
      if (!rows[0]) throw new Error("endpoint_binding_changed");
      if (fence) {
        const { rows: leases } = await tx.execute<{ requested_by: number | null }>(sql`SELECT requested_by FROM epdr_read_sync_requests
          WHERE id = ${fence.requestId} AND connection_id = ${connectionId}
          AND account_revision = ${accountRevision} AND status = 'running'
          AND lease_token = ${fence.leaseToken} AND lease_until > clock_timestamp() FOR UPDATE`);
        if (!leases[0]) throw new Error("endpoint_lease_lost");
        if (leases[0].requested_by === null) throw new Error("read_sync_actor_unavailable");
        await assertReadSyncActor(tx, siteId, leases[0].requested_by);
      }
      return write(tx);
    });
  }
  const client = createWatchGuardClient(creds, { credentialRevision });
  let releaseLockFn: (() => Promise<void>) | null = null;

  return {
    connectionId,
    siteId,
    tryAcquireLock: async (id) => {
      releaseLockFn = await acquireAdvisoryLock(id);
      return releaseLockFn !== null;
    },
    releaseLock: async () => {
      if (releaseLockFn) {
        await releaseLockFn();
        releaseLockFn = null;
      }
    },
    async *iterateDevices() {
      for await (const d of client.iterateDevices()) yield d as EndpointSourceDevice;
    },
    async *iterateProtectionStatus() {
      for await (const p of client.iterateProtectionStatus()) yield p as EndpointSourceProtection;
    },
    async listUnmanagedDevices() {
      const page = await client.listUnmanagedDevices({ top: 1000, skip: 0 });
      return page.data.map((u) => ({ ...u } as EndpointSourceUnmanaged));
    },
    async existingDeviceIds(id) {
      const rows = await db
        .select({ wgDeviceId: epdrEndpoints.wgDeviceId })
        .from(epdrEndpoints)
        .where(and(eq(epdrEndpoints.connectionId, id), eq(epdrEndpoints.accountRevision, accountRevision), isNull(epdrEndpoints.removedAt)));
      return new Set(rows.map((r) => r.wgDeviceId));
    },
    async upsertEndpoint(id, site, merged) {
      const values = {
        connectionId: id,
        siteId: site,
        accountRevision,
        wgDeviceId: merged.wgDeviceId,
        hostName: merged.hostName,
        ipAddress: merged.ipAddress,
        macAddresses: merged.macAddresses,
        platformId: merged.platformId,
        operatingSystem: merged.operatingSystem,
        deviceType: merged.deviceType,
        agentVersion: merged.agentVersion,
        groupPath: merged.groupPath,
        securityConfigurationId: merged.securityConfigurationId,
        securityConfigurationName: merged.securityConfigurationName,
        isolationState: merged.isolationState,
        licenseStatus: merged.licenseStatus,
        encryption: merged.encryption,
        lastConnectionAt: merged.lastConnectionAt,
        accumulatedProtectionStatus: merged.accumulatedProtectionStatus,
        adaptiveDefenseStatus: merged.adaptiveDefenseStatus,
        fileAntivirusStatus: merged.fileAntivirusStatus,
        firewallStatus: merged.firewallStatus,
        protectionEngineUpdateStatus: merged.protectionEngineUpdateStatus,
        protectionEngineVersion: merged.protectionEngineVersion,
        knowledgeCatalogUpdateStatus: merged.knowledgeCatalogUpdateStatus,
        knowledgeCatalogDate: merged.knowledgeCatalogDate,
        rebootRequested: merged.rebootRequested,
        reinstallProtectionRequested: merged.reinstallProtectionRequested,
        reinstallAgentRequested: merged.reinstallAgentRequested,
        reinstallProtectionError: merged.reinstallProtectionError,
        reinstallAgentError: merged.reinstallAgentError,
        lastSyncedAt: new Date(),
        raw: merged.raw,
      };
      await publish(async (tx) => tx
        .insert(epdrEndpoints)
        .values(values)
        .onConflictDoUpdate({
          target: [epdrEndpoints.connectionId, epdrEndpoints.accountRevision, epdrEndpoints.wgDeviceId],
          set: {
            accountRevision,
            hostName: merged.hostName,
            ipAddress: merged.ipAddress,
            macAddresses: merged.macAddresses,
            platformId: merged.platformId,
            operatingSystem: merged.operatingSystem,
            deviceType: merged.deviceType,
            agentVersion: merged.agentVersion,
            groupPath: merged.groupPath,
            securityConfigurationId: merged.securityConfigurationId,
            securityConfigurationName: merged.securityConfigurationName,
            isolationState: merged.isolationState,
            licenseStatus: merged.licenseStatus,
            encryption: merged.encryption,
            lastConnectionAt: merged.lastConnectionAt,
            accumulatedProtectionStatus: merged.accumulatedProtectionStatus,
            adaptiveDefenseStatus: merged.adaptiveDefenseStatus,
            fileAntivirusStatus: merged.fileAntivirusStatus,
            firewallStatus: merged.firewallStatus,
            protectionEngineUpdateStatus: merged.protectionEngineUpdateStatus,
            protectionEngineVersion: merged.protectionEngineVersion,
            knowledgeCatalogUpdateStatus: merged.knowledgeCatalogUpdateStatus,
            knowledgeCatalogDate: merged.knowledgeCatalogDate,
            rebootRequested: merged.rebootRequested,
            reinstallProtectionRequested: merged.reinstallProtectionRequested,
            reinstallAgentRequested: merged.reinstallAgentRequested,
            reinstallProtectionError: merged.reinstallProtectionError,
            reinstallAgentError: merged.reinstallAgentError,
            lastSyncedAt: new Date(),
            removedAt: null,
            raw: merged.raw,
          },
        }));
    },
    async markRemoved(id, absentIds) {
      if (absentIds.length === 0) return 0;
      const result = await publish(async (tx) => tx
        .update(epdrEndpoints)
        .set({ removedAt: new Date() })
        .where(
          and(eq(epdrEndpoints.connectionId, id), eq(epdrEndpoints.accountRevision, accountRevision), sql`${epdrEndpoints.wgDeviceId} = ANY(${absentIds})`),
        ));
      return result.rowCount ?? absentIds.length;
    },
    async upsertUnmanaged(id, site, items) {
      let count = 0;
      for (const u of items) {
        if (!u.wg_unmanaged_id) continue;
        const unmanagedId = u.wg_unmanaged_id;
        await publish(async (tx) => tx
          .insert(epdrUnmanagedDevices)
          .values({
            connectionId: id,
            siteId: site,
            wgUnmanagedId: unmanagedId,
            hostName: u.host_name ?? null,
            ipAddress: u.ip_address ?? null,
            macAddress: u.mac_address ?? null,
            status: u.status ?? null,
            installationError: u.installation_error ?? null,
            lastSeenAt: u.last_seen ? new Date(u.last_seen) : null,
            lastSyncedAt: new Date(),
            raw: u as unknown,
          })
          .onConflictDoUpdate({
            target: [epdrUnmanagedDevices.connectionId, epdrUnmanagedDevices.wgUnmanagedId],
            set: {
              hostName: u.host_name ?? null,
              ipAddress: u.ip_address ?? null,
              macAddress: u.mac_address ?? null,
              status: u.status ?? null,
              installationError: u.installation_error ?? null,
              lastSeenAt: u.last_seen ? new Date(u.last_seen) : null,
              lastSyncedAt: new Date(),
              raw: u as unknown,
            },
          }));
        count++;
      }
      return count;
    },
    async recordSyncRun(kind, status, stats, error) {
      await publish(async (tx) => tx.insert(epdrSyncRuns).values({
        connectionId,
        kind,
        startedAt: new Date(),
        finishedAt: new Date(),
        status,
        stats,
        error: error ?? null,
      }));
    },
    async touchConnection(id, error) {
      await publish(async (tx) => tx
        .update(watchguardConnections)
        .set({ ...(error ? {} : { lastEndpointSyncAt: new Date() }), lastSyncError: error ?? null, updatedAt: new Date() })
        .where(eq(watchguardConnections.id, id)));
    },
  };
}

export async function runEndpointsJob(connectionId: number, fence?: ReadSyncFence): Promise<"ok" | "partial" | "skipped_locked"> {
  const row = await db.select().from(watchguardConnections).where(eq(watchguardConnections.id, connectionId)).limit(1);
  const conn = row[0];
  if (!conn || !conn.enabled) throw new Error("endpoint_connection_unavailable");

  try {
    const resolved = await resolveWatchGuardConnection(conn.siteId, { mode: "read" });
    if (!resolved.ok) {
      await db.transaction(async (tx) => {
        const { rows: bindings } = await tx.execute(sql`SELECT id FROM watchguard_connections
          WHERE id = ${connectionId} AND site_id = ${conn.siteId} AND enabled
          AND account_revision = ${conn.accountRevision} AND credential_revision = ${conn.credentialRevision} FOR UPDATE`);
        if (!bindings[0]) return;
        if (fence) {
          const { rows: leases } = await tx.execute<{ requested_by: number | null }>(sql`SELECT requested_by FROM epdr_read_sync_requests
            WHERE id = ${fence.requestId} AND connection_id = ${connectionId} AND status = 'running'
            AND lease_token = ${fence.leaseToken} AND lease_until > clock_timestamp() FOR UPDATE`);
          if (!leases[0] || leases[0].requested_by === null) return;
          await assertReadSyncActor(tx, conn.siteId, leases[0].requested_by);
        }
        await tx.execute(sql`UPDATE watchguard_connections SET last_sync_error = 'endpoint_connection_unavailable',
          updated_at = clock_timestamp() WHERE id = ${connectionId}`);
      });
      throw new Error("endpoint_connection_unavailable");
    }

    if (resolved.accountRevision !== conn.accountRevision || resolved.credentialRevision !== conn.credentialRevision) {
      throw new Error("endpoint_binding_changed");
    }
    const summary = await syncEndpoints(endpointSyncDeps(connectionId, conn.siteId, resolved.credentials,
      resolved.credentialRevision, resolved.accountRevision, fence));
    if (summary.status === "failed") {
      throw new Error("endpoint_sync_incomplete");
    }
    return summary.status;
  } catch {
    // Only the revision/fence guarded deps publish diagnostics; never write here
    // using a stale connection snapshot after cancellation or account rebinding.
    throw new Error("endpoint_sync_failed");
  }
}

function detectSettings(row?: typeof epdrSiteSettings.$inferSelect): IngestSettings {
  const defaultSeverity = (row?.defaultSeverity ?? { "1": "High", "2": "Medium", "4": "High", "6": "High", "18": "High" }) as Record<string, "Low" | "Medium" | "High" | "Critical">;
  return {
    eventTypes: row?.eventTypes ?? [1, 2, 4, 6, 18],
    threatsyncCategories: row?.threatsyncCategories ?? ["malware", "pup", "virus", "exploit", "ioa"],
    threatsyncMinScore: row?.threatsyncMinScore ?? 7,
    threatsyncMaxScore: row?.threatsyncMaxScore ?? 10,
    defaultSeverity,
    correlationWindowMinutes: row?.correlationWindowMinutes ?? 1440,
    reopenWindowDays: row?.reopenWindowDays ?? 7,
    defaultAssigneeId: row?.defaultAssigneeId ?? null,
  };
}

async function resolveEndpointId(store: Pick<typeof db, "select">, connectionId: number, siteId: number, accountRevision: number, wgDeviceId: string): Promise<number | null> {
  const rows = await store
    .select({ id: epdrEndpoints.id })
    .from(epdrEndpoints)
    .where(and(eq(epdrEndpoints.connectionId, connectionId), eq(epdrEndpoints.siteId, siteId), eq(epdrEndpoints.accountRevision, accountRevision), eq(epdrEndpoints.wgDeviceId, wgDeviceId), isNull(epdrEndpoints.removedAt)))
    .limit(1);
  return rows[0]?.id ?? null;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Correlate an accepted endpoint-mapped detection into an Incident episode. */
async function linkDetectionToEpisode(
  siteId: number,
  endpointId: number,
  settings: IngestSettings,
  d: DetectionDraft,
  store: Pick<typeof db, "select" | "insert" | "update"> = db,
): Promise<number | null> {
  const threatKey = threatKeyFor(d.category, d.md5, d.threatName);
  // Same file hash on the same endpoint is the same threat episode even when a
  // provider reports a different category/name. Keep the exact-key match first;
  // the MD5 suffix fallback is the documented "MD5 correlation" path.
  const md5Suffix = md5ThreatKeySuffix(d.md5);
  const workflowKeyMatch = md5Suffix
    ? or(eq(epdrWorkflows.threatKey, threatKey), ilike(epdrWorkflows.threatKey, md5Suffix))
    : eq(epdrWorkflows.threatKey, threatKey);
  const now = new Date();
  const detectedAtMs = d.detectedAt.getTime();
  const correlationWindowMs = settings.correlationWindowMinutes * 60_000;
  const reopenWindowMs = settings.reopenWindowDays * 24 * 60 * 60 * 1000;

  const openRows = await store
    .select({ incidentId: epdrWorkflows.incidentId, lastDetectionAt: epdrWorkflows.lastDetectionAt, severity: incidents.severity })
    .from(epdrWorkflows)
    .innerJoin(incidents, eq(incidents.id, epdrWorkflows.incidentId))
    .where(and(
      eq(epdrWorkflows.siteId, siteId),
      eq(epdrWorkflows.endpointId, endpointId),
      workflowKeyMatch,
      inArray(incidents.status, ["Open", "In Progress"]),
    ))
    .orderBy(desc(epdrWorkflows.lastDetectionAt))
    .limit(1);

  const closedRows = await store
    .select({ incidentId: epdrWorkflows.incidentId, resolvedAt: incidents.resolvedAt, severity: incidents.severity, reopenCount: epdrWorkflows.reopenCount })
    .from(epdrWorkflows)
    .innerJoin(incidents, eq(incidents.id, epdrWorkflows.incidentId))
    .where(and(
      eq(epdrWorkflows.siteId, siteId),
      eq(epdrWorkflows.endpointId, endpointId),
      workflowKeyMatch,
      inArray(incidents.status, ["Resolved", "Verified"]),
    ))
    .orderBy(desc(incidents.resolvedAt))
    .limit(1);

  const decision = correlate({
    endpointId,
    threatKey,
    detectedAtMs,
    correlationWindowMs,
    reopenWindowMs,
    openWorkflow: openRows[0]
      ? { incidentId: openRows[0].incidentId, lastDetectionAtMs: openRows[0].lastDetectionAt.getTime(), severity: openRows[0].severity, inProgress: true }
      : null,
    closedWorkflow: closedRows[0] && closedRows[0].resolvedAt
      ? { incidentId: closedRows[0].incidentId, closedAtMs: closedRows[0].resolvedAt.getTime(), severity: closedRows[0].severity, reopenCount: closedRows[0].reopenCount }
      : null,
  });

  if (decision.kind === "attach") {
    await store.update(epdrWorkflows)
      .set({ lastDetectionAt: d.detectedAt, evidenceGeneration: sql`${epdrWorkflows.evidenceGeneration} + 1`, updatedAt: now })
      .where(eq(epdrWorkflows.incidentId, decision.incidentId));
    return decision.incidentId;
  }

  if (decision.kind === "reopen") {
    await store.update(incidents)
      .set({ status: "Open", severity: decision.severity, resolvedAt: null, resolvedById: null, resolutionCategory: null, resolutionAction: null, updatedAt: now })
      .where(eq(incidents.id, decision.incidentId));
    await store.update(epdrWorkflows)
      .set({ state: "detected", lastDetectionAt: d.detectedAt, reopenCount: decision.reopenCount, evidenceGeneration: sql`${epdrWorkflows.evidenceGeneration} + 1`, updatedAt: now })
      .where(eq(epdrWorkflows.incidentId, decision.incidentId));
    return decision.incidentId;
  }

  const created = await store.insert(incidents).values({
    siteId,
    deviceId: null,
    epdrEndpointId: endpointId,
    title: `${titleCase(d.category)} ${d.threatName ? `— ${d.threatName}` : ""}`.trim(),
    description: d.filePath ?? d.threatName ?? null,
    severity: d.severity,
    status: "Open",
    source: "epdr",
    externalRef: d.tsIncidentId,
    assignedToId: settings.defaultAssigneeId,
    dueDate: calculateIncidentDueDate(d.severity as "Low" | "Medium" | "High" | "Critical", now),
    createdAt: now,
    updatedAt: now,
  }).returning({ id: incidents.id });

  const id = created[0]?.id;
  if (!id) return null;
  await store.insert(epdrWorkflows).values({
    incidentId: id,
    siteId,
    endpointId,
    state: "detected",
    kind: "threat",
    threatKey,
    evidenceGeneration: 0,
    lastDetectionAt: d.detectedAt,
    reopenCount: 0,
    updatedAt: now,
  });
  return id;
}

async function runDetectionsJob(connectionId: number): Promise<void> {
  const row = await db.select().from(watchguardConnections).where(eq(watchguardConnections.id, connectionId)).limit(1);
  const conn = row[0];
  if (!conn || !conn.enabled) return;

  const [settingsRow] = await db.select().from(epdrSiteSettings).where(eq(epdrSiteSettings.siteId, conn.siteId)).limit(1);
  const settings = detectSettings(settingsRow);
  const ingestOn = Boolean(settingsRow?.ingestEnabled ?? false) || (settingsRow?.threatsyncEnabled ?? true);
  // Kill switches gate provider writes, not observation: detection reads and
  // local Incident evidence continue. No provider command exists in this job.
  if (!ingestOn) return;

  const resolved = await resolveWatchGuardConnection(conn.siteId, { mode: "read" });
  if (!resolved.ok) return;
  if (resolved.accountRevision !== conn.accountRevision || resolved.credentialRevision !== conn.credentialRevision) {
    throw new Error("detection_binding_changed");
  }
  // Serialize each evidence publication with connection reconfiguration. The
  // endpoint lookup and insert must share this lock, not merely Incident attachment.
  async function publishDetection<T>(write: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      const { rows } = await tx.execute(sql`SELECT id FROM watchguard_connections
        WHERE id = ${connectionId} AND site_id = ${conn.siteId} AND enabled
          AND account_revision = ${conn.accountRevision} AND credential_revision = ${conn.credentialRevision} FOR UPDATE`);
      if (!rows[0]) throw new Error("detection_binding_changed");
      return write(tx);
    });
  }
  const client = createWatchGuardClient(resolved.credentials, { credentialRevision: resolved.credentialRevision });

  const existingKeys = new Set(
    (await db.select({ sourceKey: epdrDetections.sourceKey }).from(epdrDetections)
      .where(and(eq(epdrDetections.connectionId, connectionId), eq(epdrDetections.accountRevision, conn.accountRevision))))
      .map((r) => r.sourceKey)
      .filter((k): k is string => k !== null),
  );

  const drafts: DetectionDraft[] = [];
  const extra: IgnoredItem[] = [];
  const readEvidence: DetectionReadEvidence[] = [];
  const binding = { connectionId, accountRevision: conn.accountRevision, credentialRevision: conn.credentialRevision, settingsUpdatedAt: settingsRow?.updatedAt ?? null };

  if (settingsRow?.threatsyncEnabled ?? true) {
    const startedAt = new Date();
    let received = 0;
    let status: DetectionReadEvidence["status"] = "failed";
    try {
      for await (const inc of client.iterateIncidents({ limit: 500 })) {
        received++;
        const r = buildThreatSyncDetections(inc, settings);
        drafts.push(...r.detections);
        extra.push(...r.unmatched);
      }
      status = "completed"; // Only reached after full iterator exhaustion.
    } catch {
      status = received > 0 ? "partial" : "failed";
      console.error(`[epdr] threatsync ingest failed for connection ${connectionId}`);
    }
    readEvidence.push({ ...binding, source: "threatsync", status, window: "provider_default", startedAt, finishedAt: new Date(), eventTypes: [], completedEventTypes: [] });
  }

  if (settingsRow?.ingestEnabled ?? false) {
    const startedAt = new Date();
    const completedEventTypes: number[] = [];
    let received = 0;
    for (const type of new Set(settings.eventTypes)) {
      try {
        for await (const ev of client.iterateSecurityEvents(type, 1)) {
          received++;
          const r = buildSecurityEventDetections([ev], settings);
          drafts.push(...r.detections);
          extra.push(...r.ignored, ...r.unmatched);
        }
        completedEventTypes.push(type);
      } catch {
        console.error(`[epdr] security-event ingest failed (type ${type}) for connection ${connectionId}`);
      }
    }
    const status = eventExportReadStatus(settings.eventTypes, completedEventTypes);
    readEvidence.push({ ...binding, source: "event_export", status: status === "failed" && received > 0 ? "partial" : status,
      window: "event_export_period_1", startedAt, finishedAt: new Date(), eventTypes: [...settings.eventTypes], completedEventTypes });
  }

  const fresh = drafts.filter((d) => !existingKeys.has(d.sourceKey));

  for (const d of fresh) {
    const { endpointId, detectionId } = await publishDetection(async (tx) => {
      const endpointId = await resolveEndpointId(tx, connectionId, conn.siteId, conn.accountRevision, d.endpointProviderId);
      const inserted = await tx.insert(epdrDetections).values({
      connectionId,
      siteId: conn.siteId,
      source: d.source,
      sourceKey: d.sourceKey,
      accountRevision: conn.accountRevision,
      endpointId,
      category: d.category,
      providerType: d.providerType,
      threatName: d.threatName,
      filePath: d.filePath,
      md5: d.md5,
      threatScore: d.threatScore,
      severity: d.severity,
      detectedAt: d.detectedAt,
      tsIncidentId: d.tsIncidentId,
      ignoredReason: endpointId === null ? "unmapped_endpoint" : null,
      raw: d.raw as object,
      }).onConflictDoNothing().returning({ id: epdrDetections.id });
      return { endpointId, detectionId: inserted[0]?.id };
    });
    if (!detectionId || endpointId === null) continue;
    await db.transaction(async (tx) => {
      await attachDetectionOnce(tx, { connectionId, siteId: conn.siteId, accountRevision: conn.accountRevision }, detectionId,
        () => linkDetectionToEpisode(conn.siteId, endpointId, settings, d, tx));
    });
  }

  // Persist out-of-scope / below-threshold / missing-entity records for review.
  for (const u of extra) {
    await publishDetection(async (tx) => tx.insert(epdrDetections).values({
      connectionId,
      siteId: conn.siteId,
      source: u.source,
      sourceKey: u.sourceKey,
      accountRevision: conn.accountRevision,
      category: "other",
      severity: "Low",
      detectedAt: new Date(),
      ignoredReason: u.reason,
      raw: u.raw as object,
    }).onConflictDoNothing());
  }

  // Publish only after the collected detections have been persisted. A crash or
  // revision change must never leave a completed checkpoint for unpublished data.
  for (const evidence of readEvidence) {
    await publishDetection(async (tx) => {
      const { rows: settings } = await tx.execute<{ updated_at: Date | null }>(sql`SELECT updated_at FROM epdr_site_settings
        WHERE site_id = ${conn.siteId} FOR UPDATE`);
      // The settings action updates updated_at for each save, including off/on.
      // Compare using JS milliseconds because the timestamp driver returns Date.
      const current = settings[0]?.updated_at;
      if (Boolean(settings[0]) !== Boolean(settingsRow) ||
          (current ? new Date(current).getTime() : null) !== (binding.settingsUpdatedAt?.getTime() ?? null)) {
        throw new Error("detection_settings_changed");
      }
      await tx.insert(epdrDetectionReadEvidence).values(evidence);
    });
  }

  // Recovery: a crash between the committed detection insert and its Incident
  // attachment must not strand the detection forever. Bounded to recent rows
  // of the current account revision so a settings change never revives old
  // evidence as a new Incident.
  const recoverable = await db
    .select({
      id: epdrDetections.id, source: epdrDetections.source, sourceKey: epdrDetections.sourceKey,
      category: epdrDetections.category, providerType: epdrDetections.providerType,
      threatName: epdrDetections.threatName, filePath: epdrDetections.filePath, md5: epdrDetections.md5,
      threatScore: epdrDetections.threatScore, severity: epdrDetections.severity,
      detectedAt: epdrDetections.detectedAt, tsIncidentId: epdrDetections.tsIncidentId,
      endpointId: epdrEndpoints.id, endpointProviderId: epdrEndpoints.wgDeviceId, raw: epdrDetections.raw,
    })
    .from(epdrDetections)
    .innerJoin(epdrEndpoints, and(
      eq(epdrEndpoints.id, epdrDetections.endpointId),
      eq(epdrEndpoints.connectionId, connectionId),
      eq(epdrEndpoints.accountRevision, conn.accountRevision),
      isNull(epdrEndpoints.removedAt),
    ))
    .where(and(
      eq(epdrDetections.connectionId, connectionId),
      eq(epdrDetections.accountRevision, conn.accountRevision),
      isNull(epdrDetections.incidentId),
      isNull(epdrDetections.ignoredReason),
      gte(epdrDetections.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
    ))
    .orderBy(desc(epdrDetections.id))
    .limit(50);

  for (const row of recoverable) {
    const draft = {
      source: row.source as DetectionDraft["source"],
      sourceKey: row.sourceKey,
      category: row.category as DetectionDraft["category"],
      providerType: row.providerType,
      threatName: row.threatName,
      filePath: row.filePath,
      md5: row.md5,
      threatScore: row.threatScore,
      severity: row.severity as DetectionDraft["severity"],
      detectedAt: row.detectedAt,
      tsIncidentId: row.tsIncidentId,
      endpointProviderId: row.endpointProviderId,
      endpointId: row.endpointId,
      raw: row.raw,
    } satisfies DetectionDraft;
    await db.transaction(async (tx) => {
      await attachDetectionOnce(tx, { connectionId, siteId: conn.siteId, accountRevision: conn.accountRevision }, row.id,
        () => linkDetectionToEpisode(conn.siteId, row.endpointId, settings, draft, tx));
    });
  }
}

async function runEvaluateJob(connectionId: number): Promise<void> {
  const row = await db.select().from(watchguardConnections).where(eq(watchguardConnections.id, connectionId)).limit(1);
  const conn = row[0];
  if (!conn || !conn.enabled) return;

  const rules = await db
    .select()
    .from(epdrRules)
    .where(and(eq(epdrRules.siteId, conn.siteId), eq(epdrRules.isCurrent, true), eq(epdrRules.enabled, true), eq(epdrRules.trigger, "detection")));
  if (rules.length === 0) return;

  const [global] = await db
    .select({ killSwitch: watchguardGlobalSettings.killSwitch, allowedActions: watchguardGlobalSettings.allowedActions })
    .from(watchguardGlobalSettings)
    .limit(1);
  const [site] = await db
    .select({ siteKillSwitch: epdrSiteSettings.siteKillSwitch, automationPausedAt: epdrSiteSettings.automationPausedAt })
    .from(epdrSiteSettings)
    .where(eq(epdrSiteSettings.siteId, conn.siteId))
    .limit(1);

  const siteControls: SiteControls = {
    killSwitch: site?.siteKillSwitch ?? false,
    breakerPaused: site?.automationPausedAt !== null && site?.automationPausedAt !== undefined,
    dataStale: resolveConnectionState({
      configured: Boolean(conn.accountId),
      enabled: conn.enabled,
      lastSyncAt: conn.lastEndpointSyncAt ?? null,
      lastSyncError: conn.lastSyncError ?? null,
      syncIntervalMinutes: conn.endpointSyncMinutes ?? 15,
      nowMs: Date.now(),
    }) !== "live",
  };
  const globalControls: GlobalControls = {
    killSwitch: global?.killSwitch ?? false,
    allowedActions: global?.allowedActions ?? ["scan"],
  };

  const workflows = await db
    .select()
    .from(epdrWorkflows)
    .where(and(eq(epdrWorkflows.siteId, conn.siteId), eq(epdrWorkflows.kind, "threat")));

  for (const wf of workflows) {
    const latest = (
      await db
        .select()
        .from(epdrDetections)
        .where(and(eq(epdrDetections.incidentId, wf.incidentId), isNull(epdrDetections.ignoredReason),
          eq(epdrDetections.accountRevision, conn.accountRevision)))
        .orderBy(desc(epdrDetections.detectedAt))
        .limit(1)
    )[0];
    if (!latest) continue;

    const endpoint = latest.endpointId
      ? (await db.select().from(epdrEndpoints).where(and(
          eq(epdrEndpoints.id, latest.endpointId),
          eq(epdrEndpoints.siteId, conn.siteId),
          eq(epdrEndpoints.connectionId, connectionId),
          eq(epdrEndpoints.accountRevision, conn.accountRevision),
        )).limit(1))[0]
      : undefined;

    const [incident] = await db.select({ automationHold: incidents.automationHold })
      .from(incidents).where(and(eq(incidents.id, wf.incidentId), eq(incidents.siteId, conn.siteId))).limit(1);

    const exclusionConditions = [
      latest.md5 ? eq(epdrExclusions.matchMd5, latest.md5) : undefined,
      latest.threatName ? eq(epdrExclusions.matchThreatName, latest.threatName) : undefined,
      latest.endpointId ? eq(epdrExclusions.endpointId, latest.endpointId) : undefined,
    ].filter((value) => value !== undefined);
    const [exclusion] = exclusionConditions.length > 0
      ? await db.select({ id: epdrExclusions.id }).from(epdrExclusions).where(and(
          eq(epdrExclusions.siteId, conn.siteId),
          gte(epdrExclusions.expiresAt, new Date()),
          or(...exclusionConditions),
        )).limit(1)
      : [];

    const [asset] = endpoint?.deviceId
      ? await db.select({ isCritical: devices.isCritical }).from(devices)
          .where(and(eq(devices.id, endpoint.deviceId), eq(devices.siteId, conn.siteId))).limit(1)
      : [];

    for (const rule of rules) {
      const [recentAction] = latest.endpointId
        ? await db.select({ id: epdrActions.id }).from(epdrActions).where(and(
            eq(epdrActions.siteId, conn.siteId),
            eq(epdrActions.endpointId, latest.endpointId),
            eq(epdrActions.actionType, rule.actionType),
            gte(epdrActions.createdAt, new Date(Date.now() - rule.cooldownMinutes * 60_000)),
          )).limit(1)
        : [];
      const ruleInput: PolicyRule = {
        enabled: rule.enabled,
        trigger: rule.trigger as "detection",
        categories: rule.categories,
        minScore: rule.minScore,
        maxScore: rule.maxScore,
        deviceTypes: rule.deviceTypes,
        actionType: rule.actionType,
        executionMode: rule.executionMode as "simulate" | "approval" | "automatic",
      };
      const ep: PolicyEndpoint = {
        deviceType: endpoint?.deviceType ?? null,
        isCritical: endpoint?.isCritical ?? false,
        assetCritical: asset?.isCritical ?? false,
        noAuto: endpoint?.noAuto ?? false,
        removedAt: endpoint?.removedAt ?? null,
        lastConnectionAt: endpoint?.lastConnectionAt ?? null,
        resolvedTarget: endpoint != null,
      };
      const result = evaluatePolicy({
        detection: { category: latest.category, threatScore: latest.threatScore },
        endpoint: ep,
        incident: { automationHold: incident?.automationHold ?? true, exclusionActive: exclusion !== undefined },
        rule: ruleInput,
        site: siteControls,
        global: globalControls,
        nowMs: Date.now(),
        cooldownActive: recentAction !== undefined,
      });

      await db.insert(epdrRuleEvaluations).values({
        siteId: conn.siteId,
        incidentId: wf.incidentId,
        endpointId: latest.endpointId,
        ruleId: rule.id,
        triggerDetectionId: latest.id,
        decision: result.decision,
        effectiveMode: result.effectiveMode,
        reasons: result.reasons as object,
      }).onConflictDoNothing();
    }
  }
}

async function runHealthJob(connectionId: number): Promise<void> {
  const row = await db.select().from(watchguardConnections).where(eq(watchguardConnections.id, connectionId)).limit(1);
  const conn = row[0];
  if (!conn || !conn.enabled) return;

  const [settingsRow] = await db.select().from(epdrSiteSettings).where(eq(epdrSiteSettings.siteId, conn.siteId)).limit(1);
  if (!(settingsRow?.healthEnabled ?? false)) return;

  const settings: HealthSettings = {
    graceMinutes: settingsRow?.healthGraceMinutes ?? 30,
    stageWaitMinutes: (settingsRow?.healthStageWaitHours ?? 24) * 60,
    stableMinutes: settingsRow?.healthStableMinutes ?? 60,
    rebootMode: (settingsRow?.healthRebootMode as "off" | "approval" | "automatic") ?? "approval",
  };

  const endpoints = await db
    .select()
    .from(epdrEndpoints)
    .where(and(eq(epdrEndpoints.siteId, conn.siteId), isNull(epdrEndpoints.removedAt)));

  const now = new Date();
  for (const ep of endpoints) {
    const cls = classifyHealth(
      {
        accumulatedProtectionStatus: ep.accumulatedProtectionStatus,
        protectionEngineUpdateStatus: ep.protectionEngineUpdateStatus,
        knowledgeCatalogUpdateStatus: ep.knowledgeCatalogUpdateStatus,
        rebootRequested: ep.rebootRequested,
        lastConnectionAt: ep.lastConnectionAt,
      },
      now.getTime(),
    );

    const [open] = await db.select().from(epdrHealthCases).where(and(eq(epdrHealthCases.endpointId, ep.id), isNull(epdrHealthCases.closedAt))).limit(1);

    if (cls.problem === "none") {
      if (open && open.healthySince === null) {
        await db.update(epdrHealthCases).set({ healthySince: now }).where(eq(epdrHealthCases.id, open.id));
      }
      continue;
    }
    if (cls.problem === "no_license" || cls.offline) continue;

    if (!open) {
      await db.insert(epdrHealthCases).values({
        siteId: conn.siteId,
        endpointId: ep.id,
        problem: cls.problem,
        stage: 0,
        openedAt: now,
        stageChangedAt: now,
        lastStatus: { accumulatedProtectionStatus: ep.accumulatedProtectionStatus },
      });
      continue;
    }

    const decision = advanceHealthStage(
      { problem: cls.problem, offline: cls.offline, rebootFlag: cls.problem === "pending_restart" },
      { stage: open.stage, stageChangedAt: open.stageChangedAt, healthySince: open.healthySince, currentProblem: open.problem as never },
      settings,
      now.getTime(),
    );

    if (decision.nextStage !== open.stage) {
      await db.update(epdrHealthCases)
        .set({ stage: decision.nextStage, stageChangedAt: now, problem: cls.problem, lastStatus: { accumulatedProtectionStatus: ep.accumulatedProtectionStatus } })
        .where(eq(epdrHealthCases.id, open.id));
    }
  }
}

export const EPDR_JOBS: EpdrJob[] = [
  { name: "endpoints", run: async (id) => {
    const outcome = await runEndpointsJob(id);
    if (outcome === "skipped_locked") throw new Error("endpoint_sync_locked");
    if (outcome === "partial") throw new Error("endpoint_sync_failed");
  } },
  { name: "detections", run: runDetectionsJob },
  { name: "evaluate", run: runEvaluateJob },
  { name: "health", run: runHealthJob },
  // dispatch/tasks/provider_sync/verify remain: they either perform write
  // (blocked under read-only) or poll task status (see T07/T08 follow-ups).
];

export function hasJob(name: string): boolean {
  return EPDR_JOBS.some((job) => job.name === name);
}