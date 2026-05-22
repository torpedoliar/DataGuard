import { describe, expect, it } from "vitest";
import { DEFAULT_SIEM_RULES } from "./default-rules";

describe("default SIEM rules", () => {
  it("ships all 26 default rule keys", () => {
    expect(DEFAULT_SIEM_RULES.map((rule) => rule.key)).toEqual([
      "auth.failed_login_spike",
      "auth.success_after_failures",
      "auth.login_from_unknown_ip",
      "auth.admin_login_outside_hours",
      "auth.new_username_seen",
      "network.interface_down_critical",
      "network.interface_flap",
      "network.trunk_uplink_down",
      "network.stp_topology_burst",
      "network.dhcp_conflict",
      "firewall.deny_burst_source",
      "firewall.deny_burst_critical_destination",
      "firewall.port_scan_pattern",
      "firewall.vpn_login_failure_spike",
      "firewall.ips_critical_signature",
      "system.device_reboot",
      "system.config_changed",
      "system.config_changed_outside_maintenance",
      "system.power_supply_failure",
      "system.fan_temp_warning",
      "system.disk_full",
      "system.service_crash",
      "health.source_silent",
      "health.log_volume_spike",
      "health.parser_error_spike",
      "health.unknown_source_high_volume",
    ]);
  });

  it("uses unique keys and alertable high-impact defaults", () => {
    const keys = DEFAULT_SIEM_RULES.map((rule) => rule.key);
    expect(new Set(keys).size).toBe(26);
    expect(DEFAULT_SIEM_RULES.every((rule) => rule.enabled)).toBe(true);
    expect(DEFAULT_SIEM_RULES.find((rule) => rule.key === "auth.success_after_failures")?.severity).toBe("Critical");
    expect(DEFAULT_SIEM_RULES.find((rule) => rule.key === "auth.success_after_failures")?.alertEnabled).toBe(true);
  });

  it("uses Phase 01 rule data shape", () => {
    for (const rule of DEFAULT_SIEM_RULES) {
      expect(rule.name.length).toBeGreaterThan(3);
      expect(rule.description.length).toBeGreaterThan(3);
      expect(rule.description).not.toBe(rule.name);
      expect(rule.category.length).toBeGreaterThan(2);
      expect(rule.ruleType).toEqual(expect.any(String));
      expect(rule).not.toHaveProperty("type");
      expect(rule).toHaveProperty("threshold");
      expect(rule).toHaveProperty("windowSeconds");
      expect(rule.cooldownSeconds).toBeGreaterThan(0);
      expect(rule.conditions).toMatchObject({ normalizedTypes: expect.any(Array) });
      expect(rule.groupBy).toEqual(expect.any(Array));
    }
  });

  it("keeps representative defaults aligned with the phase plan", () => {
    expect(DEFAULT_SIEM_RULES.find((rule) => rule.key === "auth.failed_login_spike")).toMatchObject({
      ruleType: "threshold",
      category: "Authentication",
      conditions: { normalizedTypes: ["auth_failed"] },
      groupBy: ["deviceId", "srcIp", "username"],
      threshold: 5,
      windowSeconds: 300,
      alertEnabled: true,
    });
    expect(DEFAULT_SIEM_RULES.find((rule) => rule.key === "auth.admin_login_outside_hours")).toMatchObject({
      severity: "Medium",
      alertEnabled: false,
    });
    expect(DEFAULT_SIEM_RULES.find((rule) => rule.key === "network.interface_flap")).toMatchObject({
      severity: "Medium",
      threshold: 4,
      windowSeconds: 600,
      alertEnabled: false,
    });
    expect(DEFAULT_SIEM_RULES.find((rule) => rule.key === "system.service_crash")).toMatchObject({
      severity: "Medium",
      groupBy: ["deviceId", "program"],
      alertEnabled: false,
    });
  });
});
