# SIEM Phase 01 Core Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SIEM database foundation, shared SIEM types, and a 26-rule seed definition without changing current app behavior.

**Architecture:** Keep domain constants in `lib/siem/`, persist SIEM state through Drizzle/Postgres tables, and generate one additive migration. Default rules are pure data first so later workers and UI can reuse them without DB access.

**Tech Stack:** Next.js 16, TypeScript, Drizzle ORM, PostgreSQL, Vitest, RTK-wrapped npm/git commands.

---

## File Structure

- Create `lib/siem/types.ts`: SIEM enum arrays, type aliases, parser helpers for severity/status/rule type.
- Create `lib/siem/types.test.ts`: pure tests for enum helpers.
- Create `lib/siem/default-rules.ts`: all 26 default SIEM rule definitions.
- Create `lib/siem/default-rules.test.ts`: validates rule count, unique keys, rule families, and required defaults.
- Modify `db/schema.ts`: add SIEM enums, tables, indexes, and relations.
- Generate `drizzle/*.sql` and `drizzle/meta/*.json`: additive migration.
- Modify `package.json`: add `siem:seed-rules` only if the implementation creates a DB seed script in this phase.

---

### Task 1: Shared SIEM Types

**Files:**
- Create: `lib/siem/types.ts`
- Create: `lib/siem/types.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/siem/types.test.ts
import { describe, expect, it } from "vitest";
import {
  isSiemAlertStatus,
  isSiemFindingStatus,
  isSiemRuleType,
  isSiemSeverity,
  siemAlertStatuses,
  siemFindingStatuses,
  siemRuleTypes,
  siemSeverities,
} from "./types";

describe("SIEM type helpers", () => {
  it("exports stable enum values", () => {
    expect(siemSeverities).toEqual(["Low", "Medium", "High", "Critical"]);
    expect(siemFindingStatuses).toEqual(["Open", "Acknowledged", "Resolved"]);
    expect(siemAlertStatuses).toEqual(["pending", "sent", "failed"]);
    expect(siemRuleTypes).toEqual(["single_event", "threshold", "sequence", "absence", "baseline_anomaly"]);
  });

  it("accepts valid values and rejects invalid values", () => {
    expect(isSiemSeverity("High")).toBe(true);
    expect(isSiemSeverity("Emergency")).toBe(false);
    expect(isSiemFindingStatus("Acknowledged")).toBe(true);
    expect(isSiemFindingStatus("Closed")).toBe(false);
    expect(isSiemAlertStatus("failed")).toBe(true);
    expect(isSiemAlertStatus("error")).toBe(false);
    expect(isSiemRuleType("threshold")).toBe(true);
    expect(isSiemRuleType("correlation")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm RED**

Run: `rtk npm run test -- lib/siem/types.test.ts`

Expected: FAIL because `lib/siem/types.ts` does not exist.

- [ ] **Step 3: Create type helpers**

```ts
// lib/siem/types.ts
export const siemSeverities = ["Low", "Medium", "High", "Critical"] as const;
export type SiemSeverity = typeof siemSeverities[number];

export const siemFindingStatuses = ["Open", "Acknowledged", "Resolved"] as const;
export type SiemFindingStatus = typeof siemFindingStatuses[number];

export const siemAlertStatuses = ["pending", "sent", "failed"] as const;
export type SiemAlertStatus = typeof siemAlertStatuses[number];

export const siemRuleTypes = ["single_event", "threshold", "sequence", "absence", "baseline_anomaly"] as const;
export type SiemRuleType = typeof siemRuleTypes[number];

export const siemVendors = ["generic", "mikrotik", "cisco", "fortigate", "linux"] as const;
export type SiemVendor = typeof siemVendors[number];

export const syslogIngestStatuses = ["received", "parsed", "parse_failed", "dropped"] as const;
export type SyslogIngestStatus = typeof syslogIngestStatuses[number];

function isOneOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

export function isSiemSeverity(value: unknown): value is SiemSeverity {
  return isOneOf(siemSeverities, value);
}

export function isSiemFindingStatus(value: unknown): value is SiemFindingStatus {
  return isOneOf(siemFindingStatuses, value);
}

export function isSiemAlertStatus(value: unknown): value is SiemAlertStatus {
  return isOneOf(siemAlertStatuses, value);
}

export function isSiemRuleType(value: unknown): value is SiemRuleType {
  return isOneOf(siemRuleTypes, value);
}
```

- [ ] **Step 4: Run test to confirm GREEN**

Run: `rtk npm run test -- lib/siem/types.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit types**

Run:

```bash
rtk git add lib/siem/types.ts lib/siem/types.test.ts && rtk git commit -m "feat: add SIEM shared types"
```

Expected: commit succeeds.

---

### Task 2: Default 26-Rule Pack

**Files:**
- Create: `lib/siem/default-rules.ts`
- Create: `lib/siem/default-rules.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/siem/default-rules.test.ts
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

  it("defines required evaluation settings", () => {
    for (const rule of DEFAULT_SIEM_RULES) {
      expect(rule.name.length).toBeGreaterThan(3);
      expect(rule.category.length).toBeGreaterThan(2);
      expect(rule.cooldownSeconds).toBeGreaterThan(0);
      expect(rule.conditions).toMatchObject({ normalizedTypes: expect.any(Array) });
      expect(rule.groupBy).toEqual(expect.any(Array));
    }
  });
});
```

- [ ] **Step 2: Run test to confirm RED**

Run: `rtk npm run test -- lib/siem/default-rules.test.ts`

Expected: FAIL because `lib/siem/default-rules.ts` does not exist.

- [ ] **Step 3: Create default rule definitions**

```ts
// lib/siem/default-rules.ts
import type { SiemRuleType, SiemSeverity } from "./types";

export type DefaultSiemRule = {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: SiemSeverity;
  category: string;
  ruleType: SiemRuleType;
  conditions: { normalizedTypes: string[]; outcomes?: string[]; tags?: string[] };
  groupBy: string[];
  threshold: number | null;
  windowSeconds: number | null;
  cooldownSeconds: number;
  alertEnabled: boolean;
};

function rule(input: Omit<DefaultSiemRule, "enabled" | "cooldownSeconds"> & { cooldownSeconds?: number }): DefaultSiemRule {
  return { enabled: true, cooldownSeconds: input.cooldownSeconds ?? 300, ...input };
}

export const DEFAULT_SIEM_RULES: DefaultSiemRule[] = [
  rule({ key: "auth.failed_login_spike", name: "Failed login spike", description: "Repeated failed logins from the same source.", severity: "High", category: "Authentication", ruleType: "threshold", conditions: { normalizedTypes: ["auth_failed"] }, groupBy: ["deviceId", "srcIp", "username"], threshold: 5, windowSeconds: 300, alertEnabled: true }),
  rule({ key: "auth.success_after_failures", name: "Successful login after repeated failures", description: "A successful login follows repeated failed attempts.", severity: "Critical", category: "Authentication", ruleType: "sequence", conditions: { normalizedTypes: ["auth_failed", "auth_success"] }, groupBy: ["deviceId", "srcIp", "username"], threshold: 5, windowSeconds: 600, alertEnabled: true }),
  rule({ key: "auth.login_from_unknown_ip", name: "Login from unknown IP", description: "Authentication activity from an unmapped source address.", severity: "Medium", category: "Authentication", ruleType: "single_event", conditions: { normalizedTypes: ["auth_success"], tags: ["unknown_source"] }, groupBy: ["srcIp", "username"], threshold: null, windowSeconds: null, alertEnabled: false }),
  rule({ key: "auth.admin_login_outside_hours", name: "Admin login outside working hours", description: "Admin login observed outside configured work hours.", severity: "Medium", category: "Authentication", ruleType: "single_event", conditions: { normalizedTypes: ["auth_success"], tags: ["admin", "outside_hours"] }, groupBy: ["deviceId", "username"], threshold: null, windowSeconds: null, alertEnabled: false }),
  rule({ key: "auth.new_username_seen", name: "New username seen", description: "A username not previously observed appears in syslog.", severity: "Low", category: "Authentication", ruleType: "single_event", conditions: { normalizedTypes: ["auth_failed", "auth_success"], tags: ["new_username"] }, groupBy: ["username"], threshold: null, windowSeconds: null, alertEnabled: false }),
  rule({ key: "network.interface_down_critical", name: "Interface down on critical device", description: "A critical device reports an interface down event.", severity: "High", category: "Network", ruleType: "single_event", conditions: { normalizedTypes: ["interface_down"], tags: ["critical_device"] }, groupBy: ["deviceId", "interfaceName"], threshold: null, windowSeconds: null, alertEnabled: true }),
  rule({ key: "network.interface_flap", name: "Interface flap", description: "Interface up/down repeats within a short window.", severity: "Medium", category: "Network", ruleType: "threshold", conditions: { normalizedTypes: ["interface_down", "interface_up"] }, groupBy: ["deviceId", "interfaceName"], threshold: 4, windowSeconds: 600, alertEnabled: false }),
  rule({ key: "network.trunk_uplink_down", name: "Trunk or uplink down", description: "An uplink or trunk interface goes down.", severity: "High", category: "Network", ruleType: "single_event", conditions: { normalizedTypes: ["interface_down"], tags: ["uplink"] }, groupBy: ["deviceId", "interfaceName"], threshold: null, windowSeconds: null, alertEnabled: true }),
  rule({ key: "network.stp_topology_burst", name: "STP topology change burst", description: "Spanning tree topology changes repeat in a short window.", severity: "Medium", category: "Network", ruleType: "threshold", conditions: { normalizedTypes: ["stp_topology_change"] }, groupBy: ["deviceId"], threshold: 5, windowSeconds: 300, alertEnabled: false }),
  rule({ key: "network.dhcp_conflict", name: "DHCP conflict", description: "Device reports DHCP conflict.", severity: "Medium", category: "Network", ruleType: "single_event", conditions: { normalizedTypes: ["dhcp_conflict"] }, groupBy: ["deviceId", "srcIp"], threshold: null, windowSeconds: null, alertEnabled: false }),
  rule({ key: "firewall.deny_burst_source", name: "Deny burst from same source", description: "Firewall denies many events from the same source.", severity: "Medium", category: "Firewall", ruleType: "threshold", conditions: { normalizedTypes: ["firewall_deny"] }, groupBy: ["deviceId", "srcIp"], threshold: 50, windowSeconds: 300, alertEnabled: false }),
  rule({ key: "firewall.deny_burst_critical_destination", name: "Deny burst to critical destination", description: "Firewall denies many events toward a critical destination.", severity: "High", category: "Firewall", ruleType: "threshold", conditions: { normalizedTypes: ["firewall_deny"], tags: ["critical_destination"] }, groupBy: ["deviceId", "dstIp"], threshold: 20, windowSeconds: 300, alertEnabled: true }),
  rule({ key: "firewall.port_scan_pattern", name: "Port scan pattern", description: "A source touches many destination ports.", severity: "High", category: "Firewall", ruleType: "threshold", conditions: { normalizedTypes: ["firewall_deny"], tags: ["port_scan"] }, groupBy: ["deviceId", "srcIp"], threshold: 20, windowSeconds: 300, alertEnabled: true }),
  rule({ key: "firewall.vpn_login_failure_spike", name: "VPN login failure spike", description: "Repeated VPN login failures.", severity: "High", category: "Firewall", ruleType: "threshold", conditions: { normalizedTypes: ["vpn_login_failed"] }, groupBy: ["deviceId", "srcIp", "username"], threshold: 5, windowSeconds: 300, alertEnabled: true }),
  rule({ key: "firewall.ips_critical_signature", name: "IPS critical signature", description: "Critical IPS event observed.", severity: "Critical", category: "Firewall", ruleType: "single_event", conditions: { normalizedTypes: ["ips_alert"], tags: ["critical"] }, groupBy: ["deviceId", "srcIp", "dstIp"], threshold: null, windowSeconds: null, alertEnabled: true }),
  rule({ key: "system.device_reboot", name: "Device reboot", description: "Device reports reboot or restart.", severity: "Medium", category: "System", ruleType: "single_event", conditions: { normalizedTypes: ["device_reboot"] }, groupBy: ["deviceId"], threshold: null, windowSeconds: null, alertEnabled: false }),
  rule({ key: "system.config_changed", name: "Config changed", description: "Device configuration changed.", severity: "Medium", category: "System", ruleType: "single_event", conditions: { normalizedTypes: ["config_changed"] }, groupBy: ["deviceId", "username"], threshold: null, windowSeconds: null, alertEnabled: false }),
  rule({ key: "system.config_changed_outside_maintenance", name: "Config changed outside maintenance", description: "Configuration changed outside maintenance window.", severity: "High", category: "System", ruleType: "single_event", conditions: { normalizedTypes: ["config_changed"], tags: ["outside_maintenance"] }, groupBy: ["deviceId", "username"], threshold: null, windowSeconds: null, alertEnabled: true }),
  rule({ key: "system.power_supply_failure", name: "Power supply failure", description: "Power supply alarm observed.", severity: "Critical", category: "System", ruleType: "single_event", conditions: { normalizedTypes: ["hardware_alert"], tags: ["power"] }, groupBy: ["deviceId"], threshold: null, windowSeconds: null, alertEnabled: true }),
  rule({ key: "system.fan_temp_warning", name: "Fan or temperature warning", description: "Fan or temperature alarm observed.", severity: "High", category: "System", ruleType: "single_event", conditions: { normalizedTypes: ["hardware_alert"], tags: ["thermal"] }, groupBy: ["deviceId"], threshold: null, windowSeconds: null, alertEnabled: true }),
  rule({ key: "system.disk_full", name: "Disk full", description: "Host reports disk full or low disk space.", severity: "High", category: "System", ruleType: "single_event", conditions: { normalizedTypes: ["disk_full"] }, groupBy: ["deviceId"], threshold: null, windowSeconds: null, alertEnabled: true }),
  rule({ key: "system.service_crash", name: "Service crash", description: "Host reports service crash.", severity: "Medium", category: "System", ruleType: "single_event", conditions: { normalizedTypes: ["service_crash"] }, groupBy: ["deviceId", "program"], threshold: null, windowSeconds: null, alertEnabled: false }),
  rule({ key: "health.source_silent", name: "Syslog source silent", description: "Expected syslog source stopped sending logs.", severity: "High", category: "SIEM Health", ruleType: "absence", conditions: { normalizedTypes: [] }, groupBy: ["sourceId"], threshold: null, windowSeconds: 1800, alertEnabled: true }),
  rule({ key: "health.log_volume_spike", name: "Sudden log volume spike", description: "Source emits far more logs than recent baseline.", severity: "Medium", category: "SIEM Health", ruleType: "baseline_anomaly", conditions: { normalizedTypes: [] }, groupBy: ["sourceId"], threshold: 3, windowSeconds: 900, alertEnabled: false }),
  rule({ key: "health.parser_error_spike", name: "Parser error spike", description: "Raw events fail parsing repeatedly.", severity: "Medium", category: "SIEM Health", ruleType: "threshold", conditions: { normalizedTypes: ["parser_error"] }, groupBy: ["sourceIp"], threshold: 10, windowSeconds: 300, alertEnabled: false }),
  rule({ key: "health.unknown_source_high_volume", name: "Unknown source sending many events", description: "Unmapped source sends many events.", severity: "Medium", category: "SIEM Health", ruleType: "threshold", conditions: { normalizedTypes: [], tags: ["unknown_source"] }, groupBy: ["sourceIp"], threshold: 100, windowSeconds: 900, alertEnabled: false }),
];
```

- [ ] **Step 4: Run default rule tests**

Run: `rtk npm run test -- lib/siem/default-rules.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit rule pack**

Run:

```bash
rtk git add lib/siem/default-rules.ts lib/siem/default-rules.test.ts && rtk git commit -m "feat: add default SIEM rule pack"
```

Expected: commit succeeds.

---

### Task 3: Drizzle Schema Additions

**Files:**
- Modify: `db/schema.ts`

- [ ] **Step 1: Extend Drizzle imports**

Change the `pg-core` import to include `jsonb` and `index`:

```ts
import { integer, pgTable, text, serial, boolean, timestamp, pgEnum, uniqueIndex, jsonb, index } from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Add SIEM enums near existing enums**

```ts
export const syslogTransportEnum = pgEnum("syslog_transport", ["udp", "tcp", "tls"]);
export const syslogIngestStatusEnum = pgEnum("syslog_ingest_status", ["received", "parsed", "parse_failed", "dropped"]);
export const syslogVendorEnum = pgEnum("syslog_vendor", ["generic", "mikrotik", "cisco", "fortigate", "linux"]);
export const syslogTrustLevelEnum = pgEnum("syslog_trust_level", ["unknown", "trusted", "untrusted"]);
export const siemRuleTypeEnum = pgEnum("siem_rule_type", ["single_event", "threshold", "sequence", "absence", "baseline_anomaly"]);
export const siemFindingStatusEnum = pgEnum("siem_finding_status", ["Open", "Acknowledged", "Resolved"]);
export const siemAlertChannelEnum = pgEnum("siem_alert_channel", ["telegram", "email", "webhook"]);
export const siemAlertStatusEnum = pgEnum("siem_alert_status", ["pending", "sent", "failed"]);
```

- [ ] **Step 3: Add SIEM tables after `auditLogs`**

Add the table definitions in this order so references resolve: `syslogSources`, `syslogEventsRaw`, `syslogEvents`, `siemRules`, `siemFindings`, `siemAlerts`, `siemSettings`.

Use these column names exactly:

```ts
export const syslogSources = pgTable("syslog_sources", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id),
  deviceId: integer("device_id").references(() => devices.id),
  sourceIp: text("source_ip").notNull(),
  hostname: text("hostname"),
  displayName: text("display_name").notNull(),
  vendor: syslogVendorEnum("vendor").notNull().default("generic"),
  product: text("product"),
  parserProfile: text("parser_profile").notNull().default("generic"),
  trustLevel: syslogTrustLevelEnum("trust_level").notNull().default("unknown"),
  enabled: boolean("enabled").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at"),
  eventCount: integer("event_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  siteSourceIpIdx: index("syslog_sources_site_source_ip_idx").on(table.siteId, table.sourceIp),
  sourceIpIdx: index("syslog_sources_source_ip_idx").on(table.sourceIp),
  hostnameIdx: index("syslog_sources_hostname_idx").on(table.hostname),
  deviceIdIdx: index("syslog_sources_device_id_idx").on(table.deviceId),
  enabledIdx: index("syslog_sources_enabled_idx").on(table.enabled),
}));

export const syslogEventsRaw = pgTable("syslog_events_raw", {
  id: serial("id").primaryKey(),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  sourceIp: text("source_ip").notNull(),
  sourcePort: integer("source_port").notNull(),
  transport: syslogTransportEnum("transport").notNull().default("udp"),
  rawMessage: text("raw_message").notNull(),
  rawSize: integer("raw_size").notNull(),
  ingestStatus: syslogIngestStatusEnum("ingest_status").notNull().default("received"),
  parseError: text("parse_error"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  receivedAtIdx: index("syslog_events_raw_received_at_idx").on(table.receivedAt),
  sourceReceivedIdx: index("syslog_events_raw_source_received_idx").on(table.sourceIp, table.receivedAt),
  statusReceivedIdx: index("syslog_events_raw_status_received_idx").on(table.ingestStatus, table.receivedAt),
}));

export const syslogEvents = pgTable("syslog_events", {
  id: serial("id").primaryKey(),
  rawEventId: integer("raw_event_id").references(() => syslogEventsRaw.id).notNull(),
  eventTime: timestamp("event_time"),
  receivedAt: timestamp("received_at").notNull(),
  sourceIp: text("source_ip").notNull(),
  hostname: text("hostname"),
  facility: integer("facility"),
  severity: integer("severity"),
  priority: integer("priority"),
  appName: text("app_name"),
  program: text("program"),
  processId: text("process_id"),
  message: text("message").notNull(),
  siteId: integer("site_id").references(() => sites.id),
  deviceId: integer("device_id").references(() => devices.id),
  sourceId: integer("source_id").references(() => syslogSources.id),
  vendor: syslogVendorEnum("vendor"),
  parser: text("parser").notNull(),
  category: text("category"),
  normalizedType: text("normalized_type"),
  action: text("action"),
  outcome: text("outcome"),
  srcIp: text("src_ip"),
  srcPort: integer("src_port"),
  dstIp: text("dst_ip"),
  dstPort: integer("dst_port"),
  username: text("username"),
  interfaceName: text("interface_name"),
  protocol: text("protocol"),
  tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  receivedAtIdx: index("syslog_events_received_at_idx").on(table.receivedAt),
  siteReceivedIdx: index("syslog_events_site_received_idx").on(table.siteId, table.receivedAt),
  deviceReceivedIdx: index("syslog_events_device_received_idx").on(table.deviceId, table.receivedAt),
  sourceReceivedIdx: index("syslog_events_source_received_idx").on(table.sourceIp, table.receivedAt),
  normalizedReceivedIdx: index("syslog_events_normalized_received_idx").on(table.normalizedType, table.receivedAt),
  severityReceivedIdx: index("syslog_events_severity_received_idx").on(table.severity, table.receivedAt),
  categoryReceivedIdx: index("syslog_events_category_received_idx").on(table.category, table.receivedAt),
}));
```

Add remaining SIEM tables using the same naming style:

```ts
export const siemRules = pgTable("siem_rules", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  severity: incidentSeverityEnum("severity").notNull(),
  category: text("category").notNull(),
  ruleType: siemRuleTypeEnum("rule_type").notNull(),
  conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  groupBy: jsonb("group_by").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  threshold: integer("threshold"),
  windowSeconds: integer("window_seconds"),
  cooldownSeconds: integer("cooldown_seconds").notNull().default(300),
  alertEnabled: boolean("alert_enabled").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  enabledIdx: index("siem_rules_enabled_idx").on(table.enabled),
  categoryIdx: index("siem_rules_category_idx").on(table.category),
  severityIdx: index("siem_rules_severity_idx").on(table.severity),
}));

export const siemFindings = pgTable("siem_findings", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id),
  deviceId: integer("device_id").references(() => devices.id),
  sourceId: integer("source_id").references(() => syslogSources.id),
  ruleId: integer("rule_id").references(() => siemRules.id),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  humanAnalysis: text("human_analysis"),
  recommendedAction: text("recommended_action"),
  aiAnalysis: jsonb("ai_analysis").$type<Record<string, unknown> | null>(),
  aiGeneratedAt: timestamp("ai_generated_at"),
  severity: incidentSeverityEnum("severity").notNull(),
  status: siemFindingStatusEnum("status").notNull().default("Open"),
  eventCount: integer("event_count").notNull().default(0),
  firstSeenAt: timestamp("first_seen_at").notNull(),
  lastSeenAt: timestamp("last_seen_at").notNull(),
  sampleEventIds: jsonb("sample_event_ids").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
  correlationKey: text("correlation_key").notNull(),
  acknowledgedBy: integer("acknowledged_by").references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedBy: integer("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  createdIncidentId: integer("created_incident_id").references(() => incidents.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  statusSeverityLastSeenIdx: index("siem_findings_status_severity_last_seen_idx").on(table.status, table.severity, table.lastSeenAt),
  siteStatusSeverityIdx: index("siem_findings_site_status_severity_idx").on(table.siteId, table.status, table.severity),
  deviceStatusIdx: index("siem_findings_device_status_idx").on(table.deviceId, table.status),
  ruleCorrelationUnique: uniqueIndex("siem_findings_rule_correlation_unique").on(table.ruleId, table.correlationKey),
}));

export const siemAlerts = pgTable("siem_alerts", {
  id: serial("id").primaryKey(),
  findingId: integer("finding_id").references(() => siemFindings.id).notNull(),
  channel: siemAlertChannelEnum("channel").notNull(),
  recipient: text("recipient"),
  status: siemAlertStatusEnum("status").notNull().default("pending"),
  message: text("message").notNull(),
  sentAt: timestamp("sent_at"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  findingIdx: index("siem_alerts_finding_idx").on(table.findingId),
  statusCreatedIdx: index("siem_alerts_status_created_idx").on(table.status, table.createdAt),
}));

export const siemSettings = pgTable("siem_settings", {
  id: serial("id").primaryKey(),
  defaultSiemSiteId: integer("default_siem_site_id").references(() => sites.id),
  udpPort: integer("udp_port").notNull().default(514),
  tcpEnabled: boolean("tcp_enabled").notNull().default(false),
  tcpPort: integer("tcp_port").notNull().default(514),
  tlsEnabled: boolean("tls_enabled").notNull().default(false),
  tlsPort: integer("tls_port").notNull().default(6514),
  maxMessageSize: integer("max_message_size").notNull().default(16384),
  queueLimit: integer("queue_limit").notNull().default(1000),
  batchSize: integer("batch_size").notNull().default(100),
  flushIntervalMs: integer("flush_interval_ms").notNull().default(1000),
  rawRetentionDays: integer("raw_retention_days").notNull().default(90),
  eventRetentionDays: integer("event_retention_days").notNull().default(180),
  findingRetentionDays: integer("finding_retention_days").notNull().default(365),
  alertRetentionDays: integer("alert_retention_days").notNull().default(365),
  alertMinSeverity: incidentSeverityEnum("alert_min_severity").notNull().default("High"),
  unknownSourceEnabled: boolean("unknown_source_enabled").notNull().default(true),
  aiEnabled: boolean("ai_enabled").notNull().default(false),
  aiEndpointUrl: text("ai_endpoint_url"),
  aiApiKey: text("ai_api_key"),
  aiModelOpus: text("ai_model_opus"),
  aiModelSonnet: text("ai_model_sonnet"),
  aiModelHaiku: text("ai_model_haiku"),
  aiDefaultModel: text("ai_default_model"),
  aiMaxSampleEvents: integer("ai_max_sample_events").notNull().default(5),
  aiMaxRawLength: integer("ai_max_raw_length").notNull().default(2000),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

- [ ] **Step 4: Run TypeScript check**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit schema change**

Run:

```bash
rtk git add db/schema.ts && rtk git commit -m "feat: add SIEM database schema"
```

Expected: commit succeeds.

---

### Task 4: Migration Generation

**Files:**
- Create: `drizzle/*.sql`
- Modify: `drizzle/meta/_journal.json`
- Create/Modify: `drizzle/meta/*.json`

- [ ] **Step 1: Generate migration**

Run: `rtk npm run db:generate`

Expected: Drizzle creates one additive migration for SIEM enums, tables, indexes, and foreign keys.

- [ ] **Step 2: Verify migration applies to an empty database**

Run: `rtk npm run db:migrate`

Expected: migration completes without destructive prompts.

- [ ] **Step 3: Run full phase verification**

Run:

```bash
rtk npm run test -- lib/siem/types.test.ts lib/siem/default-rules.test.ts && rtk npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit migration**

Run:

```bash
rtk git add drizzle db/schema.ts && rtk git commit -m "feat: add SIEM schema migration"
```

Expected: commit succeeds.

---

### Task 5: Phase 01 Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run targeted tests**

Run: `rtk npm run test -- lib/siem/types.test.ts lib/siem/default-rules.test.ts`

Expected: PASS.

- [ ] **Step 2: Run project checks**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Confirm no app behavior changed**

Run: `rtk git diff --stat HEAD~4..HEAD`

Expected: diff contains only SIEM types/rules/schema/migration files.
