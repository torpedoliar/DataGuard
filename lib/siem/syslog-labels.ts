import type { UiTone } from "@/lib/ui/status";

export const syslogSeverityLabels = [
  "Emergency",
  "Alert",
  "Critical",
  "Error",
  "Warning",
  "Notice",
  "Informational",
  "Debug",
] as const;

export const syslogFacilityLabels = [
  "kernel",
  "user",
  "mail",
  "daemon",
  "auth",
  "syslog",
  "lpr",
  "news",
  "uucp",
  "clock",
  "authpriv",
  "ftp",
  "ntp",
  "audit",
  "alert",
  "clock2",
  "local0",
  "local1",
  "local2",
  "local3",
  "local4",
  "local5",
  "local6",
  "local7",
] as const;

export function getSyslogSeverityLabel(severity: number | null | undefined) {
  if (severity === null || severity === undefined) return "unknown";
  return syslogSeverityLabels[severity] ?? `severity ${severity}`;
}

export function getSyslogFacilityLabel(facility: number | null | undefined) {
  if (facility === null || facility === undefined) return "unknown";
  return syslogFacilityLabels[facility] ?? `facility ${facility}`;
}

export function getSyslogSeverityTone(severity: number | null | undefined): UiTone {
  if (severity === null || severity === undefined) return "neutral";
  if (severity <= 3) return "danger";
  if (severity === 4) return "warning";
  if (severity === 5) return "info";
  return "neutral";
}
