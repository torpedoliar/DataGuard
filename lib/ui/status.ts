export type UiTone =
  | "neutral"
  | "success"
  | "warning"
  | "orange"
  | "danger"
  | "info"
  | "accent"
  | "purple";

export function getChecklistStatusTone(status: string | null | undefined): UiTone {
  if (status === "OK") return "success";
  if (status === "Warning") return "warning";
  if (status === "Error") return "danger";
  return "neutral";
}

export function getIncidentSeverityTone(severity: string | null | undefined): UiTone {
  if (severity === "Critical") return "danger";
  if (severity === "High") return "orange";
  if (severity === "Medium") return "warning";
  return "neutral";
}

export function getIncidentStatusTone(status: string | null | undefined): UiTone {
  if (status === "Verified") return "success";
  if (status === "Resolved") return "purple";
  if (status === "In Progress") return "accent";
  if (status === "Open") return "info";
  return "neutral";
}
