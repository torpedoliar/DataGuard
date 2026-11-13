/**
 * Response schemas for the WatchGuard Cloud APIs.
 *
 * All object schemas use `.passthrough()` and keep unknown enum/status values
 * as their raw numeric/string form — a new provider value must never throw and
 * is later treated as "needs review" by higher tickets. Column names are the
 * documented provider field names; dc-check's own snake_case DB columns are
 * mapped later in T03/T05, not here.
 */
import { z } from "zod";

// ---- Token (OAuth client-credentials) -------------------------------------

export const tokenResponseSchema = z
  .object({
    access_token: z.string(),
    token_type: z.string().optional(),
    expires_in: z.number().optional(),
  })
  .passthrough();

// ---- Accounts ---------------------------------------------------------------

export const accountSchema = z
  .object({
    id: z.string().optional(),
    account_id: z.string().optional(),
    name: z.string().optional(),
    account_type: z.number().int().optional(),
  })
  .passthrough();

// ---- Endpoint Security: devices / protection / tasks ------------------------

export const deviceSchema = z
  .object({
    device_id: z.string().optional(),
    host_name: z.string().optional(),
    ip_address: z.string().optional(),
    platform_id: z.number().int().optional(),
    operating_system: z.string().optional(),
    device_type: z.number().int().optional(),
    agent_version: z.string().optional(),
    group_path: z.string().optional(),
    last_connection: z.string().optional(),
  })
  .passthrough();

export const protectionStatusSchema = z
  .object({
    device_id: z.string().optional(),
    accumulated_protection_status: z.number().int().optional(),
    adaptive_defense_status: z.number().int().optional(),
    file_antivirus_status: z.number().int().optional(),
    firewall_status: z.number().int().optional(),
    protection_engine_update_status: z.number().int().optional(),
    knowledge_catalog_update_status: z.number().int().optional(),
    reboot_requested: z.boolean().optional(),
    reinstall_protection_requested: z.boolean().optional(),
    reinstall_agent_requested: z.boolean().optional(),
  })
  .passthrough();

export const unmanagedDeviceSchema = z
  .object({
    unmanaged_device_id: z.string().optional(),
    device_id: z.string().optional(),
    host_name: z.string().optional(),
    ip_address: z.string().optional(),
    status: z.number().int().optional(),
    installation_error: z.string().nullable().optional(),
    last_seen: z.string().optional(),
  })
  .passthrough();

export const managedConfigurationSchema = z
  .object({
    config_id: z.string().optional(),
    type: z.number().int().optional(),
    name: z.string().optional(),
  })
  .passthrough();

export const securityEventSchema = z
  .object({
    device_id: z.string().optional(),
    host_name: z.string().optional(),
    event_type: z.number().int().optional(),
    threat_name: z.string().optional(),
    file_path: z.string().optional(),
    md5: z.string().optional(),
    detected_at: z.string().optional(),
  })
  .passthrough();

export const taskSchema = z
  .object({
    task_id: z.string().optional(),
    type: z.number().int().optional(),
    task_name: z.string().optional(),
    status: z.number().int().optional(),
    created_at: z.string().optional(),
  })
  .passthrough();

export const taskJobStatusSchema = z
  .object({
    job_id: z.string().optional(),
    device_id: z.string().optional(),
    status: z.number().int().optional(),
    affected_items: z.number().int().nullable().optional(),
    start_time: z.string().optional(),
    finish_time: z.string().optional(),
  })
  .passthrough();

// ---- ThreatSync -------------------------------------------------------------

export const threatSyncIncidentSchema = z
  .object({
    id: z.string().optional(),
    category: z.string().optional(),
    type: z.string().optional(),
    threatScore: z.number().int().optional(),
    threat_score: z.number().int().optional(),
    severity: z.string().optional(),
    status: z.string().optional(),
    entities: z.union([
      z.array(z.unknown()),
      z.record(z.string(), z.object({}).passthrough()).transform((entities) =>
        Object.entries(entities).map(([entityId, entity]) => ({ ...entity, entityId })),
      ),
    ]).optional(),
    recommended_actions: z.array(z.unknown()).optional(),
    remediated: z.boolean().optional(),
  })
  .passthrough()
  .transform((incident) => ({
    ...incident,
    threat_score: incident.threatScore ?? incident.threat_score,
  }));

export const threatSyncActionSchema = z
  .object({
    id: z.string().optional(),
    action_id: z.string().optional(),
    status: z.string().optional(),
    command: z.string().optional(),
    entity_id: z.string().optional(),
  })
  .passthrough();

// ---- Envelopes --------------------------------------------------------------

/** `{ data: [...], total_items: n }` list envelope (devices, tasks, …). */
export const dataEnvelopeSchema = z
  .object({
    data: z.array(z.unknown()),
    total_items: z.number().int().nullable().optional(),
  })
  .passthrough();

/** ThreatSync field reference uses items; the published example uses groups._default. */
export const threatSyncListEnvelopeSchema = z.union([
  z.object({
    items: z.array(z.unknown()),
    count: z.number().int().nonnegative().nullable().optional(),
  }).passthrough(),
  z.object({
    groups: z.object({ _default: z.array(z.unknown()) }).passthrough(),
    count: z.number().int().nonnegative().nullable().optional(),
  }).passthrough(),
]);

export type DeviceRecord = z.infer<typeof deviceSchema>;
export type ProtectionStatusRecord = z.infer<typeof protectionStatusSchema>;
export type SecurityEventRecord = z.infer<typeof securityEventSchema>;
export type TaskRecord = z.infer<typeof taskSchema>;
export type TaskJobStatusRecord = z.infer<typeof taskJobStatusSchema>;
export type ThreatSyncIncidentRecord = z.infer<typeof threatSyncIncidentSchema>;