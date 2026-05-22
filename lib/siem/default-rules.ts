import type { SiemRuleType, SiemSeverity } from "./types";

export type DefaultSiemRule = {
  key: string;
  name: string;
  description: string;
  category: string;
  severity: SiemSeverity;
  type: SiemRuleType;
  enabled: boolean;
  alertEnabled: boolean;
  cooldownSeconds: number;
  conditions: {
    normalizedTypes: string[];
    [key: string]: unknown;
  };
  groupBy: string[];
};

function rule(
  key: string,
  name: string,
  category: string,
  severity: SiemSeverity,
  type: SiemRuleType,
  normalizedTypes: string[],
  groupBy: string[] = [],
  conditions: Record<string, unknown> = {},
): DefaultSiemRule {
  return {
    key,
    name,
    description: name,
    category,
    severity,
    type,
    enabled: true,
    alertEnabled: severity === "High" || severity === "Critical",
    cooldownSeconds: 300,
    conditions: {
      normalizedTypes,
      ...conditions,
    },
    groupBy,
  };
}

export const DEFAULT_SIEM_RULES: readonly DefaultSiemRule[] = [
  rule("auth.failed_login_spike", "Failed login spike", "auth", "High", "threshold", ["auth_failure"], ["sourceIp", "username"], { threshold: 10, windowSeconds: 300 }),
  rule("auth.success_after_failures", "Successful login after failures", "auth", "Critical", "sequence", ["auth_failure", "auth_success"], ["sourceIp", "username"], { maxGapSeconds: 600 }),
  rule("auth.login_from_unknown_ip", "Login from unknown IP", "auth", "Medium", "baseline_anomaly", ["auth_success"], ["username", "sourceIp"]),
  rule("auth.admin_login_outside_hours", "Admin login outside hours", "auth", "High", "single_event", ["auth_success"], ["username"], { adminOnly: true, outsideHours: true }),
  rule("auth.new_username_seen", "New username seen", "auth", "Low", "baseline_anomaly", ["auth_failure", "auth_success"], ["username"]),
  rule("network.interface_down_critical", "Critical interface down", "network", "Critical", "single_event", ["interface_down"], ["deviceId", "interfaceName"], { criticalOnly: true }),
  rule("network.interface_flap", "Interface flap", "network", "High", "threshold", ["interface_down", "interface_up"], ["deviceId", "interfaceName"], { threshold: 4, windowSeconds: 300 }),
  rule("network.trunk_uplink_down", "Trunk uplink down", "network", "Critical", "single_event", ["interface_down"], ["deviceId", "interfaceName"], { uplinkOnly: true }),
  rule("network.stp_topology_burst", "STP topology burst", "network", "Medium", "threshold", ["stp_topology_change"], ["deviceId"], { threshold: 5, windowSeconds: 300 }),
  rule("network.dhcp_conflict", "DHCP conflict", "network", "Medium", "single_event", ["dhcp_conflict"], ["deviceId", "sourceIp"]),
  rule("firewall.deny_burst_source", "Firewall deny burst by source", "firewall", "Medium", "threshold", ["firewall_deny"], ["sourceIp"], { threshold: 100, windowSeconds: 300 }),
  rule("firewall.deny_burst_critical_destination", "Firewall deny burst to critical destination", "firewall", "High", "threshold", ["firewall_deny"], ["destinationIp"], { threshold: 25, windowSeconds: 300, criticalDestinationOnly: true }),
  rule("firewall.port_scan_pattern", "Port scan pattern", "firewall", "High", "threshold", ["firewall_deny"], ["sourceIp"], { distinctDestinationPorts: 20, windowSeconds: 300 }),
  rule("firewall.vpn_login_failure_spike", "VPN login failure spike", "firewall", "High", "threshold", ["vpn_auth_failure"], ["sourceIp", "username"], { threshold: 8, windowSeconds: 300 }),
  rule("firewall.ips_critical_signature", "Critical IPS signature", "firewall", "Critical", "single_event", ["ips_alert"], ["sourceIp", "destinationIp"], { signatureSeverity: "critical" }),
  rule("system.device_reboot", "Device reboot", "system", "Medium", "single_event", ["device_reboot"], ["deviceId"]),
  rule("system.config_changed", "Configuration changed", "system", "Medium", "single_event", ["config_changed"], ["deviceId", "username"]),
  rule("system.config_changed_outside_maintenance", "Configuration changed outside maintenance", "system", "High", "single_event", ["config_changed"], ["deviceId", "username"], { outsideMaintenance: true }),
  rule("system.power_supply_failure", "Power supply failure", "system", "Critical", "single_event", ["power_supply_failure"], ["deviceId"]),
  rule("system.fan_temp_warning", "Fan or temperature warning", "system", "High", "single_event", ["fan_warning", "temperature_warning"], ["deviceId"]),
  rule("system.disk_full", "Disk full", "system", "High", "single_event", ["disk_full"], ["deviceId", "path"]),
  rule("system.service_crash", "Service crash", "system", "High", "single_event", ["service_crash"], ["deviceId", "serviceName"]),
  rule("health.source_silent", "Source silent", "health", "High", "absence", ["syslog_event"], ["sourceId"], { silenceSeconds: 900 }),
  rule("health.log_volume_spike", "Log volume spike", "health", "Medium", "baseline_anomaly", ["syslog_event"], ["sourceId"]),
  rule("health.parser_error_spike", "Parser error spike", "health", "Medium", "threshold", ["parser_error"], ["sourceId"], { threshold: 25, windowSeconds: 300 }),
  rule("health.unknown_source_high_volume", "Unknown source high volume", "health", "High", "threshold", ["unknown_source"], ["sourceIp"], { threshold: 1000, windowSeconds: 300 }),
];
