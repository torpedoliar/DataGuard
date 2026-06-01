import { normalizeGeneric } from "./generic";

export function normalizeMikrotik(message: string) {
  if (/login failure/i.test(message)) return normalizeGeneric(message.replace("login failure", "failed password"));
  if (/logged in/i.test(message)) return normalizeGeneric(message.replace("logged in", "login success"));
  if (/dhcp.*conflict/i.test(message)) return { ...normalizeGeneric(message), category: "Network", normalizedType: "dhcp_conflict", action: "dhcp", outcome: "failure" };
  if (/route.*changed/i.test(message)) return { ...normalizeGeneric(message), category: "Network", normalizedType: "route_change", action: "route", outcome: "success" };
  return normalizeGeneric(message);
}
