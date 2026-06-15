import { emptyNormalizedEvent, type NormalizedSyslogEvent } from "./types";

/**
 * Juniper Junos syslog format.
 * Format: `<priority>timestamp hostname program[pid]: message-text`
 * Common programs: mgd, dcd, rpd, dfwd, etc.
 * Returns NormalizedSyslogEvent.
 */
export function normalizeJuniper(message: string): NormalizedSyslogEvent {
  const event = emptyNormalizedEvent();

  // Match program[pid]: anywhere in the line (handles both BSD and RFC5424
  // envelopes, since both contain "program[pid]:" after hostname).
  const programMatch = message.match(/\b([a-zA-Z]+)\[(\d+)\]:\s*(.*)$/);
  if (!programMatch) return event;
  const [, program, , rest] = programMatch;
  if (!program || !rest) return event;

  const lowerProg = program.toLowerCase();

  // mgd = management daemon: config changes, login, commit
  if (lowerProg === "mgd") {
    if (/commit|UI_COMMIT/i.test(rest)) {
      const user = rest.match(/user\s+['"]?([A-Za-z0-9_.@-]+)/i)?.[1] ?? null;
      return { ...event, category: "System", normalizedType: "config_changed", action: "configure", outcome: "success", username: user, metadata: { vendor: "juniper", program } };
    }
    if (/login.*fail|auth.*fail/i.test(rest)) {
      const user = rest.match(/user\s+['"]?([A-Za-z0-9_.@-]+)/i)?.[1] ?? null;
      return { ...event, category: "Authentication", normalizedType: "auth_failed", action: "login", outcome: "failure", username: user, metadata: { vendor: "juniper", program } };
    }
    if (/login.*success|auth.*success/i.test(rest)) {
      const user = rest.match(/user\s+['"]?([A-Za-z0-9_.@-]+)/i)?.[1] ?? null;
      return { ...event, category: "Authentication", normalizedType: "auth_success", action: "login", outcome: "success", username: user, metadata: { vendor: "juniper", program } };
    }
    return { ...event, category: "System", normalizedType: "system_event", action: "system", outcome: "info", metadata: { vendor: "juniper", program } };
  }

  // rpd = routing protocol daemon: BGP/OSPF/ISIS events
  if (lowerProg === "rpd") {
    if (/up|established/i.test(rest)) {
      return { ...event, category: "Network", normalizedType: "routing_event", action: "routing", outcome: "up", metadata: { vendor: "juniper", program } };
    }
    if (/down|recv.*notify|hold.*time/i.test(rest)) {
      return { ...event, category: "Network", normalizedType: "routing_event", action: "routing", outcome: "down", metadata: { vendor: "juniper", program } };
    }
    return { ...event, category: "Network", normalizedType: "routing_event", action: "routing", outcome: "info", metadata: { vendor: "juniper", program } };
  }

  // dcd / dfwd / l2ald / mib2d / chassisd: interface and chassis events
  if (/^(dcd|dfwd|l2ald|ifstrust|mib2d|chassisd)$/i.test(lowerProg)) {
    const ifaceMatch = rest.match(/Interface\s+([A-Za-z0-9_.\/-]+)/i);
    const iface = ifaceMatch?.[1] ?? null;
    if (/changed state to up|link up|up$/i.test(rest)) {
      return { ...event, category: "Network", normalizedType: "interface_up", action: "link", outcome: "up", interfaceName: iface, metadata: { vendor: "juniper", program } };
    }
    if (/changed state to down|link down|down$/i.test(rest)) {
      return { ...event, category: "Network", normalizedType: "interface_down", action: "link", outcome: "down", interfaceName: iface, metadata: { vendor: "juniper", program } };
    }
    return { ...event, category: "Network", normalizedType: "system_event", action: "system", outcome: "info", metadata: { vendor: "juniper", program } };
  }

  // dfwd = dynamic firewall (packet filter) events
  if (lowerProg === "dfwd") {
    if (/deny|drop|block/i.test(rest)) {
      const ips = rest.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
      return { ...event, category: "Firewall", normalizedType: "firewall_deny", action: "deny", outcome: "blocked", srcIp: ips[0] ?? null, dstIp: ips[1] ?? null, metadata: { vendor: "juniper", program } };
    }
    return { ...event, category: "Firewall", normalizedType: "firewall_event", action: "filter", outcome: "info", metadata: { vendor: "juniper", program } };
  }

  return event;
}
