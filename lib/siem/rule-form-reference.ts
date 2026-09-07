// Reference data for the guided rule editor (Q2). Lists every normalizedType
// and tag the rule engine can filter on, with whether a normalizer actually
// produces it today. produced=false entries are rule-only references (no
// normalizer emits them yet) — shown with a warning in the editor so admins
// cannot silently build rules that never fire.

export type NormalizedTypeInfo = {
  value: string;
  category: string;
  produced: boolean;
};

export const KNOWN_NORMALIZED_TYPES: NormalizedTypeInfo[] = [
  { value: "auth_failed", category: "Authentication", produced: true },
  { value: "auth_success", category: "Authentication", produced: true },
  { value: "config_changed", category: "System", produced: true },
  { value: "device_reboot", category: "System", produced: true },
  { value: "dhcp_conflict", category: "Network", produced: true },
  { value: "disk_full", category: "System", produced: true },
  { value: "firewall_allow", category: "Firewall", produced: true },
  { value: "firewall_deny", category: "Firewall", produced: true },
  { value: "hardware_alert", category: "System", produced: true },
  { value: "interface_down", category: "Network", produced: true },
  { value: "interface_up", category: "Network", produced: true },
  { value: "sudo_command", category: "System", produced: true },
  { value: "service_restart", category: "System", produced: true },
  { value: "system_event", category: "System", produced: true },
  { value: "routing_event", category: "Network", produced: true },
  { value: "route_change", category: "Network", produced: true },
  { value: "firewall_event", category: "Firewall", produced: true },
  { value: "oom_killer", category: "System", produced: true },
  { value: "vpn_login_failed", category: "Firewall", produced: true },
  { value: "vpn_login_success", category: "Firewall", produced: true },
  // Rule-only references (no normalizer emits these yet):
  { value: "ips_alert", category: "Firewall", produced: false },
  { value: "parser_error", category: "SIEM Health", produced: false },
  { value: "service_crash", category: "System", produced: false },
  { value: "stp_topology_change", category: "Network", produced: false },
];

export type KnownTagInfo = {
  value: string;
  producedBy: string;
};

export const KNOWN_TAGS: KnownTagInfo[] = [
  { value: "admin", producedBy: "normalizer (admin login events)" },
  { value: "critical", producedBy: "IPS normalizer critical flag" },
  { value: "critical_device", producedBy: "parser: device flagged critical in inventory" },
  { value: "power", producedBy: "hardware_alert normalizer" },
  { value: "thermal", producedBy: "hardware_alert normalizer" },
  { value: "unknown_source", producedBy: "parser: inventory-fallback match (device_ip/device_name)" },
];

export const KNOWN_GROUP_BY_FIELDS = [
  "deviceId",
  "sourceId",
  "sourceIp",
  "srcIp",
  "srcPort",
  "dstIp",
  "dstPort",
  "username",
  "interfaceName",
  "program",
  "protocol",
] as const;
