import { siemSeverities, type SiemSeverity } from "./types";

export type RuleToggle = { id: number; enabled: boolean; alertEnabled: boolean };

// A disabled rule can never alert, so alertEnabled is forced off when !enabled.
export function clampRuleToggle(toggle: RuleToggle): RuleToggle {
  return { ...toggle, alertEnabled: toggle.enabled ? toggle.alertEnabled : false };
}

function isSeverity(value: unknown): value is SiemSeverity {
  return typeof value === "string" && (siemSeverities as readonly string[]).includes(value);
}

export function parseSiemRulesFormData(formData: FormData): {
  alertMinSeverity: SiemSeverity;
  rules: RuleToggle[];
} {
  const severity = formData.get("alertMinSeverity");
  if (!isSeverity(severity)) throw new Error("Invalid alertMinSeverity");

  const idsRaw = String(formData.get("ruleIds") ?? "").trim();
  const ids = idsRaw ? idsRaw.split(",").map((part) => Number(part.trim())).filter((n) => Number.isInteger(n) && n > 0) : [];

  const rules = ids.map((id) =>
    clampRuleToggle({
      id,
      enabled: formData.get(`enabled-${id}`) === "on",
      alertEnabled: formData.get(`alert-${id}`) === "on",
    }),
  );

  return { alertMinSeverity: severity, rules };
}
