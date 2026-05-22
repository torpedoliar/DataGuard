import { emptyNormalizedEvent } from "./types";

function field(message: string, key: string) {
  return message.match(new RegExp(`${key}=([^\\s]+)`, "i"))?.[1] ?? null;
}

export function normalizeFortigate(message: string) {
  const action = field(message, "action");
  if (action === "deny" || action === "blocked") {
    return { ...emptyNormalizedEvent(), category: "Firewall", normalizedType: "firewall_deny", action: "deny", outcome: "blocked", srcIp: field(message, "srcip"), dstIp: field(message, "dstip"), dstPort: Number(field(message, "dstport")) || null, protocol: field(message, "proto"), metadata: { vendor: "fortigate" } };
  }
  if (/vpn/i.test(message) && /fail/i.test(message)) return { ...emptyNormalizedEvent(), category: "Firewall", normalizedType: "vpn_login_failed", action: "login", outcome: "failure", username: field(message, "user"), srcIp: field(message, "remip"), metadata: { vendor: "fortigate" } };
  return emptyNormalizedEvent();
}
