import { emptyNormalizedEvent, type NormalizedSyslogEvent } from "./types";

const ipPattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

function firstIp(message: string) {
  return message.match(ipPattern)?.[0] ?? null;
}

function interfaceName(message: string) {
  return message.match(/interface\s+([A-Za-z0-9_.\/-]+)/i)?.[1] ?? null;
}

function username(message: string) {
  return message.match(/for\s+user\s+([A-Za-z0-9_.@-]+)/i)?.[1] ?? message.match(/(?:for|user(?:name)?|login)\s+([A-Za-z0-9_.@-]+)/i)?.[1] ?? null;
}

export function normalizeGeneric(message: string): NormalizedSyslogEvent {
  const lower = message.toLowerCase();
  const event = emptyNormalizedEvent();

  if (/(failed password|login failed|invalid user)/i.test(message)) {
    return { ...event, category: "Authentication", normalizedType: "auth_failed", action: "login", outcome: "failure", srcIp: firstIp(message), username: username(message) };
  }
  if (/(accepted password|login success|login successful)/i.test(message)) {
    return { ...event, category: "Authentication", normalizedType: "auth_success", action: "login", outcome: "success", srcIp: firstIp(message), username: username(message) };
  }
  if (/(link down|interface .*down)/i.test(message)) {
    return { ...event, category: "Network", normalizedType: "interface_down", action: "link", outcome: "down", interfaceName: interfaceName(message) };
  }
  if (/(link up|interface .*up)/i.test(message)) {
    return { ...event, category: "Network", normalizedType: "interface_up", action: "link", outcome: "up", interfaceName: interfaceName(message) };
  }
  if (/(denied|drop|blocked)/i.test(message)) {
    const ips = message.match(ipPattern) ?? [];
    const port = Number(message.match(/port\s+(\d+)/i)?.[1] ?? "") || null;
    return { ...event, category: "Firewall", normalizedType: "firewall_deny", action: "deny", outcome: "blocked", srcIp: ips[0] ?? null, dstIp: ips[1] ?? null, dstPort: port, protocol: lower.includes("udp") ? "udp" : lower.includes("tcp") ? "tcp" : null };
  }
  if (/(reboot|restarted|boot)/i.test(message)) return { ...event, category: "System", normalizedType: "device_reboot", action: "restart", outcome: "success" };
  if (/(configured|config changed|commit)/i.test(message)) return { ...event, category: "System", normalizedType: "config_changed", action: "configure", outcome: "success", username: username(message) };
  if (/(temperature|fan|power)/i.test(message)) return { ...event, category: "System", normalizedType: "hardware_alert", action: "alert", outcome: "warning", tags: lower.includes("power") ? ["power"] : ["thermal"] };

  return event;
}
