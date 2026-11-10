/**
 * Detection normalization + stable dedup keys (T05). Pure — no DB, no network.
 * Both intake paths (ThreatSync incidents and security-event export) normalize
 * to one detection shape and one source key per (connection, source) unique.
 */
import { createHash } from "node:crypto";

export type DetectionSource = "event_export" | "threatsync";

export type NormalizedCategory = "malware" | "pup" | "exploit" | "virus" | "ioa" | "other";

export type EpdrSeverity = "Low" | "Medium" | "High" | "Critical";

/** Export type → normalized category (spec §5.1). */
export function normalizeCategoryFromExport(type: number): NormalizedCategory {
  switch (type) {
    case 1: return "malware";
    case 2: return "pup";
    case 4: return "exploit";
    case 6: return "virus";
    case 18: return "ioa";
    default: return "other";
  }
}

/**
 * ThreatSync category → normalized category. `av` stays `other` unless the
 * provider type explicitly names virus/pup (CONTRACTS C2 — no guessed mapping).
 */
export function normalizeThreatSyncCategory(category: string, providerType?: string): NormalizedCategory {
  const c = category.trim().toLowerCase();
  if (c === "malware" || c === "file" ) return "malware";
  if (c === "pup" || c === "potentiallyunwanted") return "pup";
  if (c === "exploit") return "exploit";
  if (c === "virus") return "virus";
  if (c === "ioa") return "ioa";
  if (c === "av" && providerType && /virus|pup/i.test(providerType)) {
    return /pup/i.test(providerType) ? "pup" : "virus";
  }
  return "other";
}

export function severityFromScore(score: number | null | undefined): EpdrSeverity | null {
  if (score === null || score === undefined) return null;
  if (score >= 9 && score <= 10) return "Critical";
  if (score >= 7) return "High";
  if (score >= 4) return "Medium";
  if (score >= 1) return "Low";
  return null;
}

/** Scored-incident path: normalized category in set AND 7 <= score <= 10. */
export function isScoredIncident(category: NormalizedCategory, score: number | null | undefined, categories: readonly string[]): boolean {
  if (!categories.includes(category)) return false;
  if (score === null || score === undefined) return false;
  return score >= 7 && score <= 10;
}

function fingerprint(parts: unknown[]): string {
  return createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|"), "utf8").digest("hex").slice(0, 32);
}

/**
 * Stable event-export dedup key: provider id is scoped by type/device/time,
 * never globally unique by assumption (C2). Missing ids use a canonical
 * evidence fingerprint.
 */
export function sourceKeyForEventExport(input: {
  providerEventId?: string | null;
  type: number;
  deviceId?: string | null;
  detectedAt: string;
  threatName?: string | null;
  filePath?: string | null;
  md5?: string | null;
}): string {
  if (input.providerEventId) return `evt:${input.providerEventId}`;
  return `evt-fp:${fingerprint([input.type, input.deviceId, input.detectedAt, input.threatName, input.filePath, input.md5])}`;
}

/** ThreatSync: one detection per provider incident + entity. */
export function sourceKeyForThreatSync(tsIncidentId: string, entityId: string): string {
  return `ts:${tsIncidentId}:${entityId}`;
}