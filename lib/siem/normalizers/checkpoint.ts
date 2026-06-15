import { emptyNormalizedEvent, type NormalizedSyslogEvent } from "./types";

/**
 * Check Point firewall syslog format.
 * Lines look like: `<14>Jan 15 10:30:00 hostname CheckPoint: src=10.0.0.1 dst=8.8.8.8 proto=... action=...`
 * Returns NormalizedSyslogEvent.
 */

function field(message: string, key: string) {
  // Match key=value, value can be quoted or unquoted
  return message.match(new RegExp(`\\b${key}=("[^"]*"|'[^']*'|[^\\s]+)`, "i"))?.[1]?.replace(/^["']|["']$/g, "") ?? null;
}

function num(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeCheckpoint(message: string): NormalizedSyslogEvent {
  const event = emptyNormalizedEvent();
  const action = field(message, "action");
  if (!action) return event;

  const lowerAction = action.toLowerCase();
  const srcIp = field(message, "src") ?? field(message, "src_ip");
  const dstIp = field(message, "dst") ?? field(message, "dst_ip");
  const srcPort = num(field(message, "sport") ?? field(message, "src_port") ?? field(message, "s_port"));
  const dstPort = num(field(message, "dport") ?? field(message, "dst_port") ?? field(message, "d_port"));
  const protocol = field(message, "proto") ?? field(message, "protocol");
  const reason = field(message, "reason");
  const origRule = field(message, "originsicname") ?? field(message, "rule_name");

  if (lowerAction === "accept" || lowerAction === "allow" || lowerAction === "permit") {
    return {
      ...event,
      category: "Firewall",
      normalizedType: "firewall_allow",
      action: "allow",
      outcome: "allowed",
      srcIp,
      dstIp,
      srcPort,
      dstPort,
      protocol,
      metadata: { vendor: "checkpoint", action, reason, rule: origRule },
    };
  }
  if (lowerAction === "drop") {
    return {
      ...event,
      category: "Firewall",
      normalizedType: "firewall_deny",
      action: "drop",
      outcome: "dropped",
      srcIp,
      dstIp,
      srcPort,
      dstPort,
      protocol,
      metadata: { vendor: "checkpoint", action, reason, rule: origRule },
    };
  }
  if (lowerAction === "reject") {
    return {
      ...event,
      category: "Firewall",
      normalizedType: "firewall_deny",
      action: "reject",
      outcome: "rejected",
      srcIp,
      dstIp,
      srcPort,
      dstPort,
      protocol,
      metadata: { vendor: "checkpoint", action, reason, rule: origRule },
    };
  }
  // Unknown action keyword - still recognise it as a firewall event so the
  // rule-runner can decide what to do.
  return {
    ...event,
    category: "Firewall",
    normalizedType: "firewall_event",
    action: lowerAction,
    outcome: "info",
    srcIp,
    dstIp,
    srcPort,
    dstPort,
    protocol,
    metadata: { vendor: "checkpoint", action, reason, rule: origRule },
  };
}
