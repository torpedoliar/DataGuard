import { emptyNormalizedEvent, type NormalizedSyslogEvent } from "./types";

/**
 * Palo Alto Networks PAN-OS syslog format.
 * Lines look like: `<134>1 2024-01-15T10:30:00.123+07:00 PA-VM hostname 1,2024/01/15,10:30:00,00123456789,THREAT,url,...`
 * Returns NormalizedSyslogEvent with category="Firewall" / "Network" / "System".
 *
 * Simplified parser: takes a CSV-style payload and reads the type field at
 * index 4, action at 13, src at 9, dst at 10, dport at 16, protocol at 15.
 * This matches the PAN-OS CSV syslog format used in default forwarding profiles.
 */
export function normalizePaloAlto(message: string): NormalizedSyslogEvent {
  const event = emptyNormalizedEvent();

  // Strip the syslog envelope if present (priority + version header) so we
  // can pass the rest to the CSV parser.
  const stripped = message.replace(/^<\d+>\d+\s+\S+\s+\S+\s+\S+\s+/, "").trim();
  if (!stripped) return event;

  const fields = stripped.split(",");
  if (fields.length < 10) return event;

  // Field 4 is the log type (TRAFFIC, THREAT, CONFIG, SYSTEM, HIP-MATCH, GLOBALPROTECT, ...).
  const logType = fields[4]?.toUpperCase();
  if (!logType) return event;

  // PAN-OS THREAT/TRAFFIC fixed-column positions:
  // 9=src, 10=dst, 13=action, 14=severity, 15=protocol, 16=dport
  const srcIp = fields[9] ?? null;
  const dstIp = fields[10] ?? null;
  const action = fields[13]?.toLowerCase() ?? null;
  const protocol = fields[15] ?? null;
  const dstPort = Number(fields[16]) || null;

  const denied = action && /^(deny|drop|block|resetclient|reset-server|reset-both)$/i.test(action);

  if (/^(THREAT|GLOBALPROTECT)$/.test(logType)) {
    return {
      ...event,
      category: "Firewall",
      normalizedType: denied ? "firewall_deny" : "firewall_allow",
      action: action ?? (denied ? "deny" : "allow"),
      outcome: denied ? "blocked" : "allowed",
      srcIp: srcIp && srcIp !== "0.0.0.0" ? srcIp : null,
      dstIp: dstIp && dstIp !== "0.0.0.0" ? dstIp : null,
      dstPort,
      protocol,
      metadata: { vendor: "paloalto", logType },
    };
  }
  if (logType === "TRAFFIC") {
    return {
      ...event,
      category: "Network",
      normalizedType: denied ? "firewall_deny" : "firewall_allow",
      action: action ?? (denied ? "deny" : "allow"),
      outcome: denied ? "blocked" : "allowed",
      srcIp: srcIp && srcIp !== "0.0.0.0" ? srcIp : null,
      dstIp: dstIp && dstIp !== "0.0.0.0" ? dstIp : null,
      dstPort,
      protocol,
      metadata: { vendor: "paloalto", logType },
    };
  }
  if (logType === "CONFIG") {
    return { ...event, category: "System", normalizedType: "config_changed", action: "configure", outcome: "success", metadata: { vendor: "paloalto", logType } };
  }
  if (/^(SYSTEM|HIP-MATCH)$/.test(logType)) {
    return { ...event, category: "System", normalizedType: "system_event", action: "system", outcome: "info", metadata: { vendor: "paloalto", logType } };
  }

  return { ...event, metadata: { vendor: "paloalto", logType } };
}
