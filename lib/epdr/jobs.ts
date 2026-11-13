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
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { epdrDetections, epdrEndpoints, epdrHealthCases, epdrRuleEvaluations, epdrRules, epdrSiteSettings, epdrSyncRuns, epdrUnmanagedDevices, epdrWorkflows, incidents, watchguardConnections, watchguardGlobalSettings } from "@/db/schema";
import { buildDatabaseUrl } from "@/lib/database-url";
import { resolveWatchGuardConnection } from "@/lib/watchguard/connection";
import { createWatchGuardClient } from "@/lib/watchguard/client";
import { syncEndpoints, type EndpointSyncDeps, type EndpointSourceDevice, type EndpointSourceProtection, type EndpointSourceUnmanaged } from "./sync";
import { buildSecurityEventDetections, buildThreatSyncDetections, threatKeyFor, type DetectionDraft, type IgnoredItem } from "./detect-ingest";
import { correlate } from "./correlation";
import { evaluate as evaluatePolicy, type EndpointInput as PolicyEndpoint, type RuleInput as PolicyRule, type SiteControls, type GlobalControls } from "./policy";
import { classifyHealth, advanceHealthStage, type HealthSettings } from "./health";
import type { IngestSettings } from "./detect-ingest";

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
): EndpointSyncDeps {
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
        .where(and(eq(epdrEndpoints.connectionId, id), isNull(epdrEndpoints.removedAt)));
      return new Set(rows.map((r) => r.wgDeviceId));
    },
    async upsertEndpoint(id, site, merged) {
      const values = {
        connectionId: id,
        siteId: site,
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
      await db
        .insert(epdrEndpoints)
        .values(values)
        .onConflictDoUpdate({
          target: [epdrEndpoints.connectionId, epdrEndpoints.wgDeviceId],
          set: {
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
        });
    },
    async markRemoved(id, absentIds) {
      if (absentIds.length === 0) return 0;
      const result = await db
        .update(epdrEndpoints)
        .set({ removedAt: new Date() })
        .where(
          and(eq(epdrEndpoints.connectionId, id), sql`${epdrEndpoints.wgDeviceId} = ANY(${absentIds})`),
        );
      return result.rowCount ?? absentIds.length;
    },
    async upsertUnmanaged(id, site, items) {
      let count = 0;
      for (const u of items) {
        if (!u.wg_unmanaged_id) continue;
        await db
          .insert(epdrUnmanagedDevices)
          .values({
            connectionId: id,
            siteId: site,
            wgUnmanagedId: u.wg_unmanaged_id,
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
          });
        count++;
      }
      return count;
    },
    async recordSyncRun(kind, status, stats, error) {
      await db.insert(epdrSyncRuns).values({
        connectionId,
        kind,
        startedAt: new Date(),
        finishedAt: new Date(),
        status,
        stats,
        error: error ?? null,
      });
    },
    async touchConnection(id, error) {
      await db
        .update(watchguardConnections)
        .set({ ...(error ? {} : { lastEndpointSyncAt: new Date() }), lastSyncError: error ?? null, updatedAt: new Date() })
        .where(eq(watchguardConnections.id, id));
    },
  };
}

async function runEndpointsJob(connectionId: number): Promise<void> {
  const row = await db.select().from(watchguardConnections).where(eq(watchguardConnections.id, connectionId)).limit(1);
  const conn = row[0];
  if (!conn || !conn.enabled) return;

  try {
    const resolved = await resolveWatchGuardConnection(conn.siteId, { mode: "read" });
    if (!resolved.ok) {
      await db.update(watchguardConnections)
        .set({ lastSyncError: `connection_${resolved.reason}`, updatedAt: new Date() })
        .where(eq(watchguardConnections.id, connectionId));
      throw new Error("endpoint_connection_unavailable");
    }

    const summary = await syncEndpoints(endpointSyncDeps(connectionId, conn.siteId, resolved.credentials, resolved.credentialRevision));
    if (summary.status === "failed" || summary.status === "partial") {
      throw new Error("endpoint_sync_incomplete");
    }
  } catch {
    // syncEndpoints records safe stream errors; retain those diagnostics.
    await db.update(watchguardConnections)
      .set({ lastSyncError: sql`coalesce(${watchguardConnections.lastSyncError}, 'endpoint_sync_failed')`, updatedAt: new Date() })
      .where(eq(watchguardConnections.id, connectionId));
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

async function resolveEndpointId(connectionId: number, wgDeviceId: string): Promise<number | null> {
  const rows = await db
    .select({ id: epdrEndpoints.id })
    .from(epdrEndpoints)
    .where(and(eq(epdrEndpoints.connectionId, connectionId), eq(epdrEndpoints.wgDeviceId, wgDeviceId), isNull(epdrEndpoints.removedAt)))
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
): Promise<number | null> {
  const threatKey = threatKeyFor(d.category, d.md5, d.threatName);
  const now = new Date();
  const detectedAtMs = d.detectedAt.getTime();
  const correlationWindowMs = settings.correlationWindowMinutes * 60_000;
  const reopenWindowMs = settings.reopenWindowDays * 24 * 60 * 60 * 1000;

  const openRows = await db
    .select({ incidentId: epdrWorkflows.incidentId, lastDetectionAt: epdrWorkflows.lastDetectionAt, severity: incidents.severity })
    .from(epdrWorkflows)
    .innerJoin(incidents, eq(incidents.id, epdrWorkflows.incidentId))
    .where(and(
      eq(epdrWorkflows.siteId, siteId),
      eq(epdrWorkflows.endpointId, endpointId),
      eq(epdrWorkflows.threatKey, threatKey),
      inArray(incidents.status, ["Open", "In Progress"]),
    ))
    .orderBy(desc(epdrWorkflows.lastDetectionAt))
    .limit(1);

  const closedRows = await db
    .select({ incidentId: epdrWorkflows.incidentId, resolvedAt: incidents.resolvedAt, severity: incidents.severity, reopenCount: epdrWorkflows.reopenCount })
    .from(epdrWorkflows)
    .innerJoin(incidents, eq(incidents.id, epdrWorkflows.incidentId))
    .where(and(
      eq(epdrWorkflows.siteId, siteId),
      eq(epdrWorkflows.endpointId, endpointId),
      eq(epdrWorkflows.threatKey, threatKey),
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
    await db.update(epdrWorkflows)
      .set({ lastDetectionAt: d.detectedAt, evidenceGeneration: sql`${epdrWorkflows.evidenceGeneration} + 1`, updatedAt: now })
      .where(eq(epdrWorkflows.incidentId, decision.incidentId));
    return decision.incidentId;
  }

  if (decision.kind === "reopen") {
    await db.update(incidents)
      .set({ status: "Open", severity: decision.severity, resolvedAt: null, resolvedById: null, resolutionCategory: null, resolutionAction: null, updatedAt: now })
      .where(eq(incidents.id, decision.incidentId));
    await db.update(epdrWorkflows)
      .set({ state: "detected", lastDetectionAt: d.detectedAt, reopenCount: decision.reopenCount, evidenceGeneration: sql`${epdrWorkflows.evidenceGeneration} + 1`, updatedAt: now })
      .where(eq(epdrWorkflows.incidentId, decision.incidentId));
    return decision.incidentId;
  }

  const created = await db.insert(incidents).values({
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
    createdAt: now,
    updatedAt: now,
  }).returning({ id: incidents.id });

  const id = created[0]?.id;
  if (!id) return null;
  await db.insert(epdrWorkflows).values({
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
  if (!ingestOn || (settingsRow?.siteKillSwitch ?? false)) return;

  const resolved = await resolveWatchGuardConnection(conn.siteId, { mode: "read" });
  if (!resolved.ok) return;
  const client = createWatchGuardClient(resolved.credentials, { credentialRevision: resolved.credentialRevision });

  const existingKeys = new Set(
    (await db.select({ sourceKey: epdrDetections.sourceKey }).from(epdrDetections).where(eq(epdrDetections.connectionId, connectionId)))
      .map((r) => r.sourceKey)
      .filter((k): k is string => k !== null),
  );

  const drafts: DetectionDraft[] = [];
  const extra: IgnoredItem[] = [];

  if (settingsRow?.threatsyncEnabled ?? true) {
    try {
      for await (const inc of client.iterateIncidents({ limit: 500 })) {
        const r = buildThreatSyncDetections(inc, settings);
        drafts.push(...r.detections);
        extra.push(...r.unmatched);
      }
    } catch (error) {
      console.error(`[epdr] threatsync ingest failed for connection ${connectionId}:`, error);
    }
  }

  if (settingsRow?.ingestEnabled ?? false) {
    for (const type of settings.eventTypes) {
      try {
        for await (const ev of client.iterateSecurityEvents(type, 1)) {
          const r = buildSecurityEventDetections([ev], settings);
          drafts.push(...r.detections);
          extra.push(...r.ignored, ...r.unmatched);
        }
      } catch (error) {
        console.error(`[epdr] security-event ingest failed (type ${type}) for connection ${connectionId}:`, error);
      }
    }
  }

  const fresh = drafts.filter((d) => !existingKeys.has(d.sourceKey));

  for (const d of fresh) {
    const endpointId = await resolveEndpointId(connectionId, d.endpointProviderId);
    const inserted = await db.insert(epdrDetections).values({
      connectionId,
      siteId: conn.siteId,
      source: d.source,
      sourceKey: d.sourceKey,
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

    const detectionId = inserted[0]?.id;
    if (!detectionId || endpointId === null) continue;
    const incidentId = await linkDetectionToEpisode(conn.siteId, endpointId, settings, d);
    if (incidentId) {
      await db.update(epdrDetections).set({ incidentId }).where(eq(epdrDetections.id, detectionId));
    }
  }

  // Persist out-of-scope / below-threshold / missing-entity records for review.
  for (const u of extra) {
    await db.insert(epdrDetections).values({
      connectionId,
      siteId: conn.siteId,
      source: u.source,
      sourceKey: u.sourceKey,
      category: "other",
      severity: "Low",
      detectedAt: new Date(),
      ignoredReason: u.reason,
      raw: u.raw as object,
    }).onConflictDoNothing();
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
    dataStale: false,
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
        .where(and(eq(epdrDetections.incidentId, wf.incidentId), isNull(epdrDetections.ignoredReason)))
        .orderBy(desc(epdrDetections.detectedAt))
        .limit(1)
    )[0];
    if (!latest) continue;

    const endpoint = latest.endpointId
      ? (await db.select().from(epdrEndpoints).where(eq(epdrEndpoints.id, latest.endpointId)).limit(1))[0]
      : undefined;

    for (const rule of rules) {
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
        assetCritical: false,
        noAuto: endpoint?.noAuto ?? false,
        removedAt: endpoint?.removedAt ?? null,
        lastConnectionAt: endpoint?.lastConnectionAt ?? null,
        resolvedTarget: endpoint != null,
      };
      const result = evaluatePolicy({
        detection: { category: latest.category, threatScore: latest.threatScore },
        endpoint: ep,
        incident: { automationHold: false, exclusionActive: false },
        rule: ruleInput,
        site: siteControls,
        global: globalControls,
        nowMs: Date.now(),
        cooldownActive: false,
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
  { name: "endpoints", run: runEndpointsJob },
  { name: "detections", run: runDetectionsJob },
  { name: "evaluate", run: runEvaluateJob },
  { name: "health", run: runHealthJob },
  // dispatch/tasks/provider_sync/verify remain: they either perform write
  // (blocked under read-only) or poll task status (see T07/T08 follow-ups).
];

export function hasJob(name: string): boolean {
  return EPDR_JOBS.some((job) => job.name === name);
}