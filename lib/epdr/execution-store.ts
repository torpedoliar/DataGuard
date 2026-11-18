/**
 * Trusted-state loaders for provider write execution.
 *
 * Every value the execution policy depends on is re-read here from the
 * database, scoped to the active site, at the moment of the decision. Nothing
 * in this module accepts a client-supplied revision, enablement flag, or
 * target identity.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { resolveWatchGuardConnection } from "@/lib/watchguard/connection";
import { resolveConnectionState } from "./posture";
import { OFFLINE_FREEZE_DAYS } from "./health";

export type ExecutionSettings = {
  siteId: number;
  globalWritesEnabled: boolean;
  globalKillSwitch: boolean;
  globalAllowedActions: string[];
  /** Effective hourly cap: LEAST(site override, global ceiling). */
  maxActionsPerHour: number;
  /** Raw per-site override; null = the site follows the global ceiling. */
  siteMaxActionsPerHour: number | null;
  /** Effective cooldown minutes for this site (site row or default). */
  executionCooldownMinutes: number;
  approvalExpiryMinutes: number;
  siteWritesEnabled: boolean;
  siteAllowedActions: string[];
  siteKillSwitch: boolean;
  automationPaused: boolean;
};

export const DEFAULT_APPROVAL_EXPIRY_MINUTES = 60;
export const DEFAULT_MAX_ACTIONS_PER_HOUR = 30;
/** Manual writes to the same endpoint and action are spaced at least this long. */
export const DEFAULT_EXECUTION_COOLDOWN_MINUTES = 10;

type SettingsRow = {
  global_writes_enabled: boolean | null;
  kill_switch: boolean | null;
  allowed_actions: string[] | null;
  max_actions_per_hour_per_site: number | null;
  approval_expiry_minutes: number | null;
  site_writes_enabled: boolean | null;
  site_allowed_actions: string[] | null;
  site_kill_switch: boolean | null;
  automation_paused_at: Date | null;
  site_max_actions_per_hour: number | null;
  execution_cooldown_minutes: number | null;
};

/** Effective per-site limits against the global ceiling. */
export function effectiveExecutionLimits(
  globalMaxActionsPerHour: number,
  siteMaxActionsPerHour: number | null,
  siteCooldownMinutes: number | null,
): { maxActionsPerHour: number; executionCooldownMinutes: number } {
  return {
    // The site may narrow the global cap, never raise it.
    maxActionsPerHour: Math.min(siteMaxActionsPerHour ?? globalMaxActionsPerHour, globalMaxActionsPerHour),
    executionCooldownMinutes: siteCooldownMinutes ?? DEFAULT_EXECUTION_COOLDOWN_MINUTES,
  };
}

/**
 * Load the global and site gates in one round trip. A missing settings row
 * means "everything off", never "unrestricted".
 */
export async function loadExecutionSettings(siteId: number): Promise<ExecutionSettings> {
  const { rows } = await db.execute<SettingsRow>(sql`
    SELECT g.provider_writes_enabled AS global_writes_enabled, g.kill_switch,
      g.allowed_actions, g.max_actions_per_hour_per_site, g.approval_expiry_minutes,
      s.provider_writes_enabled AS site_writes_enabled, s.allowed_actions AS site_allowed_actions,
      s.site_kill_switch, s.automation_paused_at,
      s.max_actions_per_hour AS site_max_actions_per_hour, s.execution_cooldown_minutes
    FROM (SELECT 1) AS anchor
    LEFT JOIN watchguard_global_settings g ON g.id = 1
    LEFT JOIN epdr_site_settings s ON s.site_id = ${siteId}`);
  const row = rows[0];
  const limits = effectiveExecutionLimits(
    row?.max_actions_per_hour_per_site ?? DEFAULT_MAX_ACTIONS_PER_HOUR,
    row?.site_max_actions_per_hour ?? null,
    row?.execution_cooldown_minutes ?? null,
  );
  return {
    siteId,
    globalWritesEnabled: row?.global_writes_enabled === true,
    globalKillSwitch: row?.kill_switch === true,
    globalAllowedActions: row?.allowed_actions ?? [],
    maxActionsPerHour: limits.maxActionsPerHour,
    siteMaxActionsPerHour: row?.site_max_actions_per_hour ?? null,
    executionCooldownMinutes: limits.executionCooldownMinutes,
    approvalExpiryMinutes: row?.approval_expiry_minutes ?? DEFAULT_APPROVAL_EXPIRY_MINUTES,
    siteWritesEnabled: row?.site_writes_enabled === true,
    siteAllowedActions: row?.site_allowed_actions ?? [],
    siteKillSwitch: row?.site_kill_switch === true,
    automationPaused: row?.automation_paused_at != null,
  };
}

export type EffectiveExecutionLimits = {
  maxActionsPerHour: number;
  executionCooldownMinutes: number;
};

/**
 * Effective per-site execution limits in one round trip. Accepts an optional
 * executor so a caller can read them inside its own transaction and act on
 * exactly the values it locked.
 */
export async function loadEffectiveExecutionLimits(
  siteId: number,
  exec: Pick<typeof db, "execute"> = db,
): Promise<EffectiveExecutionLimits> {
  const { rows } = await exec.execute<{
    global_max_actions_per_hour: number | null;
    site_max_actions_per_hour: number | null;
    execution_cooldown_minutes: number | null;
  }>(sql`
    SELECT g.max_actions_per_hour_per_site AS global_max_actions_per_hour,
      s.max_actions_per_hour AS site_max_actions_per_hour, s.execution_cooldown_minutes
    FROM (SELECT 1) AS anchor
    LEFT JOIN watchguard_global_settings g ON g.id = 1
    LEFT JOIN epdr_site_settings s ON s.site_id = ${siteId}`);
  const row = rows[0];
  return effectiveExecutionLimits(
    row?.global_max_actions_per_hour ?? DEFAULT_MAX_ACTIONS_PER_HOUR,
    row?.site_max_actions_per_hour ?? null,
    row?.execution_cooldown_minutes ?? null,
  );
}

export type EndpointExecutionState = {
  endpointPresent: boolean;
  endpointRemoved: boolean;
  deviceId: string | null;
  hostName: string | null;
  isolationState: number | null;
  endpointHold: boolean;
  exclusionActive: boolean;
  dataFresh: boolean;
  evidenceGeneration: number;
  /** ThreatSync entity id when a provider incident target maps this endpoint. */
  entityId: string | null;
  providerIncidentId: string | null;
  providerIncidentAmbiguous: boolean;
};

type EndpointRow = {
  id: number;
  device_id: string | null;
  host_name: string | null;
  removed_at: Date | null;
  isolation_state: number | null;
  last_connection_at: Date | null;
  evidence_generation: number | null;
  hold: boolean | null;
  exclusion_active: boolean | null;
};

/**
 * Load the endpoint's current execution-relevant state. Missing endpoint,
 * removed endpoint, unresolved identity, stale sync, and an active hold are all
 * explicit blocking facts rather than defaults.
 */
export async function loadEndpointExecutionState(
  siteId: number,
  connectionId: number,
  endpointId: number,
): Promise<EndpointExecutionState> {
  const { rows: connectionRows } = await db.execute<{
    enabled: boolean;
    last_sync_at: Date | null;
    last_sync_error: string | null;
    sync_interval_minutes: number;
    account_revision: number;
    credential_revision: number;
  }>(sql`SELECT enabled, last_endpoint_sync_at AS last_sync_at, last_sync_error,
      endpoint_sync_minutes AS sync_interval_minutes, account_revision, credential_revision
    FROM watchguard_connections
    WHERE id = ${connectionId} AND site_id = ${siteId} LIMIT 1`);
  const connection = connectionRows[0];

  const { rows } = await db.execute<EndpointRow>(sql`
    SELECT e.id, e.wg_device_id AS device_id, e.host_name, e.removed_at, e.isolation_state,
      e.last_connection_at,
      coalesce((SELECT max(w.evidence_generation) FROM epdr_workflows w
        WHERE w.site_id = e.site_id AND w.endpoint_id = e.id), 0) AS evidence_generation,
      EXISTS (SELECT 1 FROM incidents i
        JOIN epdr_workflows w ON w.incident_id = i.id AND w.site_id = i.site_id
        WHERE w.site_id = e.site_id AND w.endpoint_id = e.id AND i.automation_hold = true
          AND i.status IN ('Open', 'In Progress')) AS hold,
      EXISTS (SELECT 1 FROM epdr_exclusions x
        WHERE x.site_id = e.site_id AND x.expires_at > clock_timestamp()
          AND (x.endpoint_id = e.id)) AS exclusion_active
    FROM epdr_endpoints e
    WHERE e.id = ${endpointId} AND e.site_id = ${siteId}
      AND e.connection_id = ${connectionId}
      AND e.account_revision = ${connection ? Number(connection.account_revision) : -1}
    LIMIT 1`);

  const row = rows[0];
  const connectionLive = connection
    ? resolveConnectionState({
        configured: true,
        enabled: connection.enabled === true,
        lastSyncAt: connection.last_sync_at ? new Date(connection.last_sync_at) : null,
        lastSyncError: connection.last_sync_error ?? null,
        syncIntervalMinutes: Number(connection.sync_interval_minutes ?? 15),
        nowMs: Date.now(),
      }) === "live"
    : false;
  // A live connection is not proof this endpoint was seen recently: the agent
  // may have been offline for days while other endpoints synced. Freshness must
  // include the endpoint's own last check-in.
  const endpointFresh = row?.last_connection_at
    ? Date.now() - new Date(row.last_connection_at).getTime() <= OFFLINE_FREEZE_DAYS * 24 * 60 * 60 * 1000
    : false;
  const dataFresh = connectionLive && endpointFresh;

  const targets = await loadProviderIncidentTargets(siteId, connectionId, endpointId);

  if (!row) {
    return {
      endpointPresent: false,
      endpointRemoved: false,
      deviceId: null,
      hostName: null,
      isolationState: null,
      endpointHold: true,
      exclusionActive: false,
      dataFresh,
      evidenceGeneration: 0,
      entityId: targets.entityId,
      providerIncidentId: targets.providerIncidentId,
      providerIncidentAmbiguous: targets.ambiguous,
    };
  }

  return {
    endpointPresent: true,
    endpointRemoved: row.removed_at != null,
    deviceId: row.device_id && row.device_id.trim().length > 0 ? row.device_id.trim() : null,
    hostName: row.host_name,
    isolationState: row.isolation_state,
    endpointHold: row.hold === true,
    exclusionActive: row.exclusion_active === true,
    dataFresh,
    evidenceGeneration: Number(row.evidence_generation ?? 0),
    entityId: targets.entityId,
    providerIncidentId: targets.providerIncidentId,
    providerIncidentAmbiguous: targets.ambiguous,
  };
}

type TargetRow = { entity_id: string; provider_incident_id: number };

/**
 * Resolve the ThreatSync entity for an endpoint. A ThreatSync id is never
 * inferred from a device id; it must exist in an *operator-confirmed* provider
 * target for this exact connection, whose incident was ingested under the
 * connection's current account revision. More than one distinct identity is
 * ambiguous, never "pick the newest".
 */
export async function loadProviderIncidentTargets(
  siteId: number,
  connectionId: number,
  endpointId: number,
): Promise<{ entityId: string | null; providerIncidentId: string | null; ambiguous: boolean }> {
  const { rows } = await db.execute<TargetRow>(sql`
    SELECT t.entity_id, p.ts_incident_id AS provider_incident_id
    FROM epdr_provider_incident_targets t
    JOIN epdr_provider_incidents p ON p.id = t.provider_incident_id
    JOIN watchguard_connections c ON c.id = p.connection_id AND c.site_id = ${siteId}
    WHERE t.endpoint_id = ${endpointId} AND p.connection_id = ${connectionId}
      AND t.review_state = 'confirmed'
      AND p.account_revision = c.account_revision
    ORDER BY t.id DESC LIMIT 20`);
  if (rows.length === 0) return { entityId: null, providerIncidentId: null, ambiguous: false };
  const distinctEntities = new Set(rows.map((row) => row.entity_id));
  const distinctIncidents = new Set(rows.map((row) => String(row.provider_incident_id)));
  return {
    entityId: distinctEntities.size === 1 ? rows[0]!.entity_id : null,
    providerIncidentId: distinctIncidents.size === 1 ? String(rows[0]!.provider_incident_id) : null,
    ambiguous: distinctEntities.size > 1 || distinctIncidents.size > 1,
  };
}

export type ConnectionBinding = {
  connectionId: number;
  enabled: boolean;
  accountRevision: number;
  credentialRevision: number;
  region: string | null;
  accountId: string | null;
};

export async function loadConnectionBinding(siteId: number): Promise<ConnectionBinding | null> {
  const { rows } = await db.execute<{
    id: number; enabled: boolean; account_revision: number; credential_revision: number;
    region: string | null; account_id: string | null;
  }>(sql`SELECT id, enabled, account_revision, credential_revision, region, account_id
    FROM watchguard_connections WHERE site_id = ${siteId} ORDER BY id ASC LIMIT 1`);
  const row = rows[0];
  if (!row) return null;
  return {
    connectionId: row.id,
    enabled: row.enabled === true,
    accountRevision: Number(row.account_revision),
    credentialRevision: Number(row.credential_revision),
    region: row.region,
    accountId: row.account_id,
  };
}

/**
 * Whether the actor is still allowed to act for this site right now.
 *
 * Used where a request is re-evaluated outside the acting user's own session
 * (worker dispatch) and where the *other* party must still hold access (the
 * approver at send time, the requester at approval time).
 */
export async function isActiveSiteAdmin(siteId: number, userId: number): Promise<boolean> {
  const { rows } = await db.execute<{ role: string }>(sql`
    SELECT u.role FROM users u JOIN sites s ON s.id = ${siteId}
    WHERE u.id = ${userId} AND u.is_active = true AND s.is_active = true LIMIT 1`);
  const row = rows[0];
  if (!row) return false;
  if (row.role === "superadmin") return true;
  const { rows: memberships } = await db.execute<{ id: number }>(sql`
    SELECT id FROM user_sites
    WHERE user_id = ${userId} AND site_id = ${siteId} AND role_in_site = 'admin' LIMIT 1`);
  return memberships.length > 0;
}

/** Whether the RW credential pair is stored and decryptable for this site. */
export async function hasWriteCredentials(siteId: number): Promise<boolean> {
  const resolved = await resolveWatchGuardConnection(siteId, { mode: "write" });
  return resolved.ok;
}

/** Count requested (not yet necessarily sent) operations created this hour. */
export async function countRecentRequests(siteId: number): Promise<number> {
  const { rows } = await db.execute<{ total: number }>(sql`
    SELECT count(*)::integer AS total FROM epdr_actions
    WHERE site_id = ${siteId} AND created_at > clock_timestamp() - interval '1 hour'
      AND state <> 'cancelled'`);
  return Number(rows[0]?.total ?? 0);
}

/**
 * Count provider writes actually attempted in the last hour for the site. Used
 * for the per-site rate limit at send time; counting *requests* would let an
 * approved backlog exceed the cap. Counts committed attempt rows, so two
 * workers cannot both pass under the same reservation. `excludeActionId`
 * removes the caller's own just-committed claim from the count.
 */
export async function countRecentDispatches(
  siteId: number,
  connectionId: number,
  excludeActionId?: number,
): Promise<number> {
  const { rows } = await db.execute<{ total: number }>(sql`
    SELECT count(*)::integer AS total FROM epdr_attempts a
    JOIN epdr_actions x ON x.id = a.action_id
    WHERE x.site_id = ${siteId} AND x.connection_id = ${connectionId} AND a.phase = 'dispatch'
      AND a.started_at > clock_timestamp() - interval '1 hour'
      ${excludeActionId !== undefined ? sql`AND a.action_id <> ${excludeActionId}` : sql``}`);
  return Number(rows[0]?.total ?? 0);
}

/**
 * Whether the same endpoint+action was attempted inside the cooldown window.
 * `cooldownMinutes` comes from the effective site limits, never a constant.
 * `excludeActionId` excludes the caller's own claim (its `dispatched_at` was
 * just set by the reservation itself).
 */
export async function hasRecentDispatch(
  siteId: number,
  connectionId: number,
  endpointId: number,
  actionType: string,
  cooldownMinutes: number,
  excludeActionId?: number,
): Promise<boolean> {
  if (cooldownMinutes <= 0) return false;
  const { rows } = await db.execute<{ id: number }>(sql`
    SELECT id FROM epdr_actions
    WHERE site_id = ${siteId} AND connection_id = ${connectionId}
      AND endpoint_id = ${endpointId} AND action_type = ${actionType}
      AND dispatched_at IS NOT NULL
      AND dispatched_at > clock_timestamp() - interval '${sql.raw(String(Math.floor(cooldownMinutes)))} minutes'
      ${excludeActionId !== undefined ? sql`AND id <> ${excludeActionId}` : sql``}
    LIMIT 1`);
  return rows.length > 0;
}
