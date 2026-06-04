export const siemSeverities = ["Low", "Medium", "High", "Critical"] as const;
export type SiemSeverity = typeof siemSeverities[number];

export const siemFindingStatuses = ["Open", "Acknowledged", "Resolved"] as const;
export type SiemFindingStatus = typeof siemFindingStatuses[number];

export const siemAlertStatuses = ["pending", "sent", "failed"] as const;
export type SiemAlertStatus = typeof siemAlertStatuses[number];

export const siemRuleTypes = ["single_event", "threshold", "sequence", "absence", "baseline_anomaly"] as const;
export type SiemRuleType = typeof siemRuleTypes[number];

export const siemVendors = ["generic", "mikrotik", "cisco", "fortigate", "linux", "watchguard"] as const;
export type SiemVendor = typeof siemVendors[number];

export const syslogIngestStatuses = ["received", "parsed", "parse_failed", "dropped"] as const;
export type SyslogIngestStatus = typeof syslogIngestStatuses[number];

function isOneOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

export function isSiemSeverity(value: unknown): value is SiemSeverity {
  return isOneOf(siemSeverities, value);
}

export function isSiemFindingStatus(value: unknown): value is SiemFindingStatus {
  return isOneOf(siemFindingStatuses, value);
}

export function isSiemAlertStatus(value: unknown): value is SiemAlertStatus {
  return isOneOf(siemAlertStatuses, value);
}

export function isSiemRuleType(value: unknown): value is SiemRuleType {
  return isOneOf(siemRuleTypes, value);
}
