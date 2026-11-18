/**
 * Pure ThreatSync provider-target ingestion builder.
 *
 * Turns `ThreatSyncIncidentRecord` rows into incident/target drafts for the
 * `provider_sync` job. Identity rules are absolute:
 * - `entity_id` comes only from an explicit provider field (the map key of the
 *   documented record-form entities, or an explicit `entity_id`/`entityId`
 *   field on an array item);
 * - `deviceId` comes only from an explicit provider device field;
 * - neither value is ever derived from the other. A device id is never used as
 *   an entity id and vice versa.
 *
 * Every target starts `unreviewed`; operator confirmation is the only path to
 * `confirmed`, and that decision lives in `actions/epdr-provider-targets.ts`.
 */
export type ProviderTargetEntityDraft = {
  /** Explicit provider entity id, or null when the provider did not give one. */
  entityId: string | null;
  /** Explicit provider device id, or null when the provider did not give one. */
  providerDeviceId: string | null;
  raw: unknown;
};

export type ProviderIncidentDraft = {
  tsIncidentId: string;
  providerStatus: string | null;
  targets: ProviderTargetEntityDraft[];
  raw: unknown;
};

export type BuildProviderTargetDraftsResult = {
  drafts: ProviderIncidentDraft[];
  ignored: { tsIncidentId: string | null; reason: string }[];
};

type IncidentLike = {
  id?: unknown;
  status?: unknown;
  entities?: unknown;
};

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Array-form entities carry identity only in explicit fields. */
function explicitEntityId(raw: Record<string, unknown>): string | null {
  return asTrimmedString(raw.entityId) ?? asTrimmedString(raw.entity_id);
}

function explicitDeviceId(raw: Record<string, unknown>): string | null {
  return asTrimmedString(raw.deviceId) ?? asTrimmedString(raw.device_id);
}

function entityItem(raw: Record<string, unknown>, keyEntityId: string | null): ProviderTargetEntityDraft | null {
  const entityId = keyEntityId ?? explicitEntityId(raw);
  const providerDeviceId = explicitDeviceId(raw);
  if (!entityId && !providerDeviceId) return null;
  return { entityId, providerDeviceId, raw };
}

function entityDrafts(entities: unknown): { targets: ProviderTargetEntityDraft[]; ignored: number } {
  // Record form: entities are keyed by id (the documented ThreatSync shape;
  // the zod schema later injects the key as `entityId`). The builder accepts
  // both the raw record form and the transformed array form.
  if (!Array.isArray(entities)) {
    if (!entities || typeof entities !== "object") return { targets: [], ignored: 0 };
    const targets: ProviderTargetEntityDraft[] = [];
    let ignored = 0;
    for (const [key, item] of Object.entries(entities)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        ignored++;
        continue;
      }
      const draft = entityItem(item as Record<string, unknown>, asTrimmedString(key));
      if (!draft) {
        ignored++;
        continue;
      }
      targets.push(draft);
    }
    return { targets, ignored };
  }

  const targets: ProviderTargetEntityDraft[] = [];
  let ignored = 0;
  for (const item of entities) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      ignored++;
      continue;
    }
    const draft = entityItem(item as Record<string, unknown>, null);
    if (!draft) {
      ignored++;
      continue;
    }
    targets.push(draft);
  }
  return { targets, ignored };
}

/**
 * Build incident/target drafts. An incident without an id is ignored; an
 * incident with no usable entity still yields a draft (with zero targets) so
 * the incident itself is recorded.
 */
export function buildProviderIncidentDrafts(
  incidents: readonly IncidentLike[],
): BuildProviderTargetDraftsResult {
  const drafts: ProviderIncidentDraft[] = [];
  const ignored: { tsIncidentId: string | null; reason: string }[] = [];
  for (const incident of incidents) {
    const tsIncidentId = asTrimmedString(incident?.id);
    if (!tsIncidentId) {
      ignored.push({ tsIncidentId: null, reason: "missing_incident_id" });
      continue;
    }
    const { targets, ignored: ignoredEntities } = entityDrafts(incident?.entities);
    if (ignoredEntities > 0) {
      ignored.push({ tsIncidentId, reason: `unidentifiable_entities:${ignoredEntities}` });
    }
    drafts.push({
      tsIncidentId,
      providerStatus: asTrimmedString(incident?.status),
      targets,
      raw: incident,
    });
  }
  return { drafts, ignored };
}

/**
 * Whether the provider's explicit device id matches exactly one live endpoint
 * on this connection and revision. `candidates` is the endpoint list for the
 * connection; the caller keeps the query on its own transaction.
 */
export function matchEndpointForDeviceId(
  providerDeviceId: string,
  endpoints: readonly { id: number; wgDeviceId: string | null }[],
): number | null {
  const exact = endpoints.filter(
    (endpoint) => endpoint.wgDeviceId !== null && endpoint.wgDeviceId === providerDeviceId,
  );
  // More than one match is ambiguous by definition; never "pick the newest".
  return exact.length === 1 ? exact[0]!.id : null;
}
