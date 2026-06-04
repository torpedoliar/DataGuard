import { emptyNormalizedEvent } from "./types";

function field(message: string, key: string) {
  return message.match(new RegExp(`${key}=("[^"]*"|[^\\s]+)`, "i"))?.[1]?.replace(/^"|"$/g, "") ?? null;
}

// WatchGuard Firebox / Fireware. Firewall traffic uses disp=Allow|Deny with
// src/dst/src_port/dst_port/proto. Auth + VPN are matched on message text.
// Field names vary by Fireware version; regex is tolerant and falls back to
// an empty normalized event (RFC layer still marks it parsed).
export function normalizeWatchguard(message: string) {
  const disp = field(message, "disp");
  if (disp) {
    const denied = /deny|drop|block/i.test(disp);
    return {
      ...emptyNormalizedEvent(),
      category: "Firewall",
      normalizedType: denied ? "firewall_deny" : "firewall_allow",
      action: denied ? "deny" : "allow",
      outcome: denied ? "blocked" : "allowed",
      srcIp: field(message, "src") ?? field(message, "src_ip"),
      dstIp: field(message, "dst") ?? field(message, "dst_ip"),
      dstPort: Number(field(message, "dst_port") ?? field(message, "dport")) || null,
      protocol: field(message, "proto"),
      metadata: { vendor: "watchguard" },
    };
  }
  if (/authentication|login/i.test(message) && /fail|reject|denied|invalid/i.test(message)) {
    return { ...emptyNormalizedEvent(), category: "Authentication", normalizedType: "auth_failed", action: "login", outcome: "failure", username: field(message, "user"), srcIp: field(message, "src"), metadata: { vendor: "watchguard" } };
  }
  if (/authentication|login/i.test(message) && /success|accept|allow/i.test(message)) {
    return { ...emptyNormalizedEvent(), category: "Authentication", normalizedType: "auth_success", action: "login", outcome: "success", username: field(message, "user"), srcIp: field(message, "src"), metadata: { vendor: "watchguard" } };
  }
  if (/(ike|ipsec|bovpn|tunnel)/i.test(message) && /(fail|down|lost)/i.test(message)) {
    return { ...emptyNormalizedEvent(), category: "Network", normalizedType: "vpn_login_failed", action: "vpn", outcome: "failure", srcIp: field(message, "src"), metadata: { vendor: "watchguard" } };
  }
  return emptyNormalizedEvent();
}
