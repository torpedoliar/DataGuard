import { db } from "../../db";
import { siemFindings, siemRules, syslogEvents, syslogSources } from "../../db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { buildFindingText } from "./human-analysis";
import { evaluateSiemRules, type SiemFindingCandidate, type SiemRuleDefinition, type SiemRuleEvent, type SiemSourceBaseline } from "./rule-engine";
import type { SiemRuleType, SiemSeverity } from "./types";

export type SiemRuleRunnerOptions = {
  lookbackSeconds?: number;
  now?: Date;
  limit?: number;
};

export type SeedSiemRule = Omit<SiemRuleDefinition, "id"> & { alertEnabled?: boolean };

function asRule(row: typeof siemRules.$inferSelect): SiemRuleDefinition {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    severity: row.severity as SiemSeverity,
    category: row.category,
    ruleType: row.ruleType as SiemRuleType,
    conditions: row.conditions,
    groupBy: row.groupBy,
    threshold: row.threshold,
    windowSeconds: row.windowSeconds,
    cooldownSeconds: row.cooldownSeconds,
  };
}

function asEvent(row: typeof syslogEvents.$inferSelect): SiemRuleEvent {
  return {
    id: row.id,
    receivedAt: row.receivedAt,
    siteId: row.siteId,
    deviceId: row.deviceId,
    sourceId: row.sourceId,
    sourceIp: row.sourceIp,
    normalizedType: row.normalizedType,
    action: row.action,
    outcome: row.outcome,
    srcIp: row.srcIp,
    srcPort: row.srcPort,
    dstIp: row.dstIp,
    dstPort: row.dstPort,
    username: row.username,
    interfaceName: row.interfaceName,
    protocol: row.protocol,
    program: row.program,
    tags: row.tags,
  };
}

function findingValues(candidate: SiemFindingCandidate, rule: SiemRuleDefinition) {
  const text = buildFindingText({ candidate, rule });

  return {
    siteId: candidate.siteId,
    deviceId: candidate.deviceId,
    sourceId: candidate.sourceId,
    ruleId: candidate.ruleId,
    title: candidate.title,
    summary: candidate.summary,
    humanAnalysis: text.humanAnalysis,
    recommendedAction: text.recommendedAction,
    severity: candidate.severity,
    status: "Open" as const,
    eventCount: candidate.eventCount,
    firstSeenAt: candidate.firstSeenAt,
    lastSeenAt: candidate.lastSeenAt,
    sampleEventIds: candidate.sampleEventIds,
    correlationKey: candidate.correlationKey,
    updatedAt: new Date(),
  };
}

async function buildAbsenceMap(rules: SiemRuleDefinition[]): Promise<Map<number, number[]>> {
  const absenceRules = rules.filter((rule) => rule.ruleType === "absence" && rule.groupBy.includes("sourceId"));
  const map = new Map<number, number[]>();
  if (absenceRules.length === 0) return map;

  const sourceRows = await db
    .select({ id: syslogSources.id })
    .from(syslogSources)
    .where(eq(syslogSources.enabled, true));

  const allSourceIds = sourceRows.map((row) => row.id);
  for (const rule of absenceRules) map.set(rule.id, allSourceIds);
  return map;
}

async function buildBaselineMap(
  rules: SiemRuleDefinition[],
  eventRows: (typeof syslogEvents.$inferSelect)[],
  now: Date,
): Promise<Map<number, SiemSourceBaseline>> {
  const baselineRules = rules.filter((rule) => rule.ruleType === "baseline_anomaly" && rule.groupBy.includes("sourceId"));
  const map = new Map<number, SiemSourceBaseline>();
  if (baselineRules.length === 0) return map;

  const sourceIds = new Set<number>();
  for (const row of eventRows) if (row.sourceId != null) sourceIds.add(row.sourceId);
  if (sourceIds.size === 0) return map;

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const historyRows = await db
    .select({ sourceId: syslogEvents.sourceId })
    .from(syslogEvents)
    .where(and(gte(syslogEvents.receivedAt, sevenDaysAgo)));

  const counts = new Map<number, number>();
  for (const row of historyRows) {
    if (row.sourceId == null) continue;
    counts.set(row.sourceId, (counts.get(row.sourceId) ?? 0) + 1);
  }
  const hours = 7 * 24;
  for (const sourceId of sourceIds) {
    const total = counts.get(sourceId) ?? 0;
    if (total === 0) continue;
    map.set(sourceId, { sourceId, avgPerHour: total / hours });
  }
  return map;
}

export async function runSiemRules(options: SiemRuleRunnerOptions = {}) {
  const now = options.now ?? new Date();
  const lookbackSeconds = options.lookbackSeconds ?? 900;
  const limit = options.limit ?? 500;

  const [ruleRows] = await Promise.all([db.select().from(siemRules).where(eq(siemRules.enabled, true))]);
  const rules = ruleRows.map(asRule);
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));

  const absenceWindowMax = rules
    .filter((rule) => rule.ruleType === "absence" && rule.groupBy.includes("sourceId"))
    .reduce((max, rule) => Math.max(max, rule.windowSeconds ?? 0), 0);
  const baselineWindowMax = rules
    .filter((rule) => rule.ruleType === "baseline_anomaly" && rule.groupBy.includes("sourceId"))
    .reduce((max, rule) => Math.max(max, rule.windowSeconds ?? 0), 0);
  const eventLookbackSeconds = Math.max(lookbackSeconds, absenceWindowMax, baselineWindowMax);
  const since = new Date(now.getTime() - eventLookbackSeconds * 1000);

  const eventRows = await db
    .select()
    .from(syslogEvents)
    .where(gte(syslogEvents.receivedAt, since))
    .orderBy(desc(syslogEvents.receivedAt))
    .limit(limit);

  const [absenceMap, baselineMap] = await Promise.all([
    buildAbsenceMap(rules),
    buildBaselineMap(rules, eventRows, now),
  ]);
  const candidates = evaluateSiemRules({ rules, events: eventRows.map(asEvent), options: { now, absence: absenceMap, baseline: baselineMap } });
  let created = 0;
  let updated = 0;

  for (const candidate of candidates) {
    const rule = ruleById.get(candidate.ruleId);
    if (!rule) continue;
    const text = buildFindingText({ candidate, rule });
    const existing = await db.query.siemFindings.findFirst({
      where: and(eq(siemFindings.ruleId, candidate.ruleId), eq(siemFindings.correlationKey, candidate.correlationKey)),
    });

    if (existing) {
      await db.update(siemFindings).set({
        eventCount: Math.max(existing.eventCount, candidate.eventCount),
        lastSeenAt: candidate.lastSeenAt,
        sampleEventIds: candidate.sampleEventIds,
        summary: candidate.summary,
        humanAnalysis: text.humanAnalysis,
        recommendedAction: text.recommendedAction,
        updatedAt: new Date(),
      }).where(eq(siemFindings.id, existing.id));
      updated++;
    } else {
      await db.insert(siemFindings).values(findingValues(candidate, rule));
      created++;
    }
  }

  return { evaluatedRules: ruleRows.length, evaluatedEvents: eventRows.length, candidates: candidates.length, created, updated };
}

// Columns that a re-seed (rule worker startup) refreshes from code. NOTE:
// `enabled` and `alertEnabled` are deliberately absent — those are
// user-controlled via /admin/siem/rules and must survive restarts/updates.
export const RESEED_CONFLICT_UPDATE_KEYS = [
  "name",
  "description",
  "severity",
  "category",
  "ruleType",
  "conditions",
  "groupBy",
  "threshold",
  "windowSeconds",
  "cooldownSeconds",
] as const;

export async function seedDefaultSiemRules(rules: SeedSiemRule[]) {
  for (const rule of rules) {
    await db.insert(siemRules).values({
      key: rule.key,
      name: rule.name,
      description: rule.description,
      enabled: rule.enabled,
      severity: rule.severity,
      category: rule.category,
      ruleType: rule.ruleType,
      conditions: rule.conditions,
      groupBy: rule.groupBy,
      threshold: rule.threshold,
      windowSeconds: rule.windowSeconds,
      cooldownSeconds: rule.cooldownSeconds,
      alertEnabled: rule.alertEnabled ?? false,
    }).onConflictDoUpdate({
      target: siemRules.key,
      // Refresh metadata from code, but preserve user-set enabled/alertEnabled.
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        severity: sql`excluded.severity`,
        category: sql`excluded.category`,
        ruleType: sql`excluded.rule_type`,
        conditions: sql`excluded.conditions`,
        groupBy: sql`excluded.group_by`,
        threshold: sql`excluded.threshold`,
        windowSeconds: sql`excluded.window_seconds`,
        cooldownSeconds: sql`excluded.cooldown_seconds`,
        updatedAt: new Date(),
      },
    });
  }

  return { seeded: rules.length };
}
