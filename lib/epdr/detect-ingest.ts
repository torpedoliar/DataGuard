/**
 * Detection ingest → DC Incident (T05). Read-only provider intake: ThreatSync
 * incidents and security-event export normalize to `epdr_detections`, dedup by
 * source_key, and correlate into one DC Incident per endpoint+threat episode.
 *
 * Pure normalization/classification/dedup lives here (unit-testable); the DB
 * side effects go through injected deps. No provider write is performed.
 */
import {
  normalizeCategoryFromExport,
  normalizeThreatSyncCategory,
  severityFromScore,
  sourceKeyForEventExport,
  sourceKeyForThreatSync,
  type EpdrSeverity,
  type NormalizedCategory,
} from "./detections";

export type IngestSettings = {
  eventTypes: number[];
  threatsyncCategories: string[];
  threatsyncMinScore: number;
  threatsyncMaxScore: number;
  defaultSeverity: Record<string, EpdrSeverity>;
  correlationWindowMinutes: number;
  reopenWindowDays: number;
  defaultAssigneeId: number | null;
};

export type ThreatSyncEntityLike = {
  entityId?: string;
  type?: string;
  deviceId?: string;
  md5?: string;
};

export type ThreatSyncIncidentLike = {
  id?: string;
  category?: string;
  type?: string;
  threat_score?: number;
  entities?: unknown[];
  status?: string;
  remediated?: boolean;
};

export type SecurityEventLike = {
  provider_event_id?: string | null;
  event_type?: number;
  device_id?: string;
  host_name?: string;
  detected_at?: string;
  threat_name?: string;
  file_path?: string;
  md5?: string;
};

export type DetectionDraft = {
  source: "event_export" | "threatsync";
  sourceKey: string;
  category: NormalizedCategory;
  providerType: string | null;
  threatName: string | null;
  filePath: string | null;
  md5: string | null;
  threatScore: number | null;
  severity: EpdrSeverity;
  detectedAt: Date;
  tsIncidentId: string | null;
  endpointProviderId: string;
  endpointId: number | null;
  raw: unknown;
};

export type IgnoredItem = { source: "event_export" | "threatsync"; sourceKey: string; reason: string; raw: unknown };

export type BuildResult = { detections: DetectionDraft[]; ignored: IgnoredItem[]; unmatched: IgnoredItem[] };

export function threatKeyFor(category: NormalizedCategory, md5?: string | null, threatName?: string | null): string {
  return `${category}:${md5 ?? threatName ?? "unknown"}`;
}

/** Classify a normalized detection — score/category threshold (ThreatSync path). */
export function classifyThreatSync(
  category: NormalizedCategory,
  score: number | null | undefined,
  settings: IngestSettings,
): { accepted: true } | { accepted: false; reason: string } {
  if (!settings.threatsyncCategories.includes(category)) {
    return { accepted: false, reason: "category_not_in_scope" };
  }
  if (score === null || score === undefined || score < settings.threatsyncMinScore || score > settings.threatsyncMaxScore) {
    return { accepted: false, reason: "score_out_of_range" };
  }
  return { accepted: true };
}

/** Build ThreatSync detections (one per entity). */
export function buildThreatSyncDetections(
  incident: ThreatSyncIncidentLike,
  settings: IngestSettings,
): { detections: DetectionDraft[]; unmatched: IgnoredItem[] } {
  const detections: DetectionDraft[] = [];
  const unmatched: IgnoredItem[] = [];
  const entities = Array.isArray(incident.entities) ? incident.entities : [];
  const category = normalizeThreatSyncCategory(incident.category ?? "", incident.type);
  const tsId = incident.id ?? "";

  const detectedAt = new Date();

  for (const raw of entities) {
    const entity = (raw ?? {}) as ThreatSyncEntityLike;
    const entityId = entity.entityId ?? entity.deviceId ?? "";
    if (!entityId) {
      unmatched.push({ source: "threatsync", sourceKey: `ts:${tsId}:none`, reason: "missing_entity_id", raw });
      continue;
    }
    const sourceKey = sourceKeyForThreatSync(tsId, entityId);
    const classification = classifyThreatSync(category, incident.threat_score, settings);
    if (!classification.accepted) {
      unmatched.push({ source: "threatsync", sourceKey, reason: classification.reason, raw });
      continue;
    }
    detections.push({
      source: "threatsync",
      sourceKey,
      category,
      providerType: incident.type ?? null,
      threatName: (entity as { threatName?: string }).threatName ?? null,
      filePath: null,
      md5: entity.md5 ?? null,
      threatScore: incident.threat_score ?? null,
      severity: severityFromScore(incident.threat_score) ?? settings.defaultSeverity[String(incident.threat_score)] ?? "High",
      detectedAt,
      tsIncidentId: tsId,
      endpointProviderId: entityId,
      endpointId: null,
      raw,
    });
  }
  return { detections, unmatched };
}

/** Build security-event detections (Malware/PUP/Exploit exported events, no score required). */
export function buildSecurityEventDetections(
  events: SecurityEventLike[],
  settings: IngestSettings,
): BuildResult {
  const detections: DetectionDraft[] = [];
  const ignored: IgnoredItem[] = [];
  const unmatched: IgnoredItem[] = [];

  for (const event of events) {
    const type = event.event_type ?? 0;
    if (!settings.eventTypes.includes(type)) {
      ignored.push({
        source: "event_export",
        sourceKey: sourceKeyForEventExport({ providerEventId: event.provider_event_id, type, deviceId: event.device_id, detectedAt: event.detected_at ?? "", threatName: event.threat_name, filePath: event.file_path, md5: event.md5 }),
        reason: "event_type_not_in_scope",
        raw: event,
      });
      continue;
    }
    const category = normalizeCategoryFromExport(type);
    if (!event.device_id) {
      unmatched.push({
        source: "event_export",
        sourceKey: sourceKeyForEventExport({ providerEventId: event.provider_event_id, type, deviceId: event.device_id, detectedAt: event.detected_at ?? "", threatName: event.threat_name, filePath: event.file_path, md5: event.md5 }),
        reason: "missing_device_id",
        raw: event,
      });
      continue;
    }
    const detectedAt = event.detected_at ? new Date(event.detected_at) : new Date();
    detections.push({
      source: "event_export",
      sourceKey: sourceKeyForEventExport({ providerEventId: event.provider_event_id, type, deviceId: event.device_id, detectedAt: event.detected_at ?? "", threatName: event.threat_name, filePath: event.file_path, md5: event.md5 }),
      category,
      providerType: String(type),
      threatName: event.threat_name ?? null,
      filePath: event.file_path ?? null,
      md5: event.md5 ?? null,
      threatScore: null,
      severity: settings.defaultSeverity[String(type)] ?? "High",
      detectedAt,
      tsIncidentId: null,
      endpointProviderId: event.device_id,
      endpointId: null,
      raw: event,
    });
  }
  return { detections, ignored, unmatched };
}

/** Keep only detections whose source_key is not already stored. */
export function dedupeDetections(detections: DetectionDraft[], existingKeys: ReadonlySet<string>): DetectionDraft[] {
  return detections.filter((d) => !existingKeys.has(d.sourceKey));
}