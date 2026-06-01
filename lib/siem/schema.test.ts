import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  siemAlerts,
  siemFindings,
  siemRules,
  siemSettings,
  syslogEvents,
  syslogEventsRaw,
  syslogSources,
} from "../../db/schema";

function columnKeys(table: Parameters<typeof getTableColumns>[0]) {
  return Object.keys(getTableColumns(table));
}

function indexNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.map((idx) => idx.config.name).sort();
}

describe("SIEM schema", () => {
  it("matches Phase 01 syslog table column names", () => {
    expect(columnKeys(syslogSources)).toEqual([
      "id",
      "siteId",
      "deviceId",
      "sourceIp",
      "hostname",
      "displayName",
      "vendor",
      "product",
      "parserProfile",
      "trustLevel",
      "enabled",
      "lastSeenAt",
      "eventCount",
      "createdAt",
      "updatedAt",
    ]);
    expect(columnKeys(syslogEventsRaw)).toEqual([
      "id",
      "receivedAt",
      "sourceIp",
      "sourcePort",
      "transport",
      "rawMessage",
      "rawSize",
      "ingestStatus",
      "parseError",
      "createdAt",
    ]);
    expect(columnKeys(syslogEvents)).toEqual([
      "id",
      "rawEventId",
      "eventTime",
      "receivedAt",
      "sourceIp",
      "hostname",
      "facility",
      "severity",
      "priority",
      "appName",
      "program",
      "processId",
      "message",
      "siteId",
      "deviceId",
      "sourceId",
      "vendor",
      "parser",
      "category",
      "normalizedType",
      "action",
      "outcome",
      "srcIp",
      "srcPort",
      "dstIp",
      "dstPort",
      "username",
      "interfaceName",
      "protocol",
      "tags",
      "metadata",
      "createdAt",
    ]);
  });

  it("matches Phase 01 SIEM rule, finding, alert, and settings names", () => {
    expect(columnKeys(siemRules)).toContain("ruleType");
    expect(columnKeys(siemRules)).toContain("threshold");
    expect(columnKeys(siemRules)).toContain("windowSeconds");

    expect(columnKeys(siemFindings)).toEqual([
      "id",
      "siteId",
      "deviceId",
      "sourceId",
      "ruleId",
      "title",
      "summary",
      "humanAnalysis",
      "recommendedAction",
      "aiAnalysis",
      "aiGeneratedAt",
      "severity",
      "status",
      "eventCount",
      "firstSeenAt",
      "lastSeenAt",
      "sampleEventIds",
      "correlationKey",
      "acknowledgedBy",
      "acknowledgedAt",
      "resolvedBy",
      "resolvedAt",
      "createdIncidentId",
      "createdAt",
      "updatedAt",
    ]);
    expect(columnKeys(siemAlerts)).toEqual([
      "id",
      "findingId",
      "channel",
      "recipient",
      "status",
      "message",
      "sentAt",
      "error",
      "createdAt",
    ]);
    expect(columnKeys(siemSettings)).not.toContain("siteId");
    expect(columnKeys(siemSettings)).toContain("defaultSiemSiteId");
    expect(columnKeys(siemSettings)).toContain("aiMaxSampleEvents");
    expect(columnKeys(siemSettings)).toContain("aiMaxRawLength");
  });

  it("uses Phase 01 index names", () => {
    expect(indexNames(syslogSources)).toEqual([
      "syslog_sources_device_id_idx",
      "syslog_sources_enabled_idx",
      "syslog_sources_hostname_idx",
      "syslog_sources_site_source_ip_idx",
      "syslog_sources_source_ip_idx",
    ]);
    expect(indexNames(siemRules)).toEqual([
      "siem_rules_category_idx",
      "siem_rules_enabled_idx",
      "siem_rules_severity_idx",
    ]);
    expect(indexNames(siemFindings)).toEqual([
      "siem_findings_device_status_idx",
      "siem_findings_rule_correlation_unique",
      "siem_findings_site_status_severity_idx",
      "siem_findings_status_severity_last_seen_idx",
    ]);
  });
});
