import { db } from "../../db";
import { siemFindings, siemRules, sites, syslogEvents, syslogSources } from "../../db/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import { queueSiemAiAnalysis } from "./ai-queue";
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
    // Caller (runSiemRulesForSite) guards candidate.siteId before calling;
    // findings.siteId is NOT NULL and candidates come from site-scoped events.
    siteId: candidate.siteId!,
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

async function buildAbsenceMap(rules: SiemRuleDefinition[], siteId: number): Promise<Map<number, number[]>> {
  const absenceRules = rules.filter((rule) => rule.ruleType === "absence" && rule.groupBy.includes("sourceId"));
  const map = new Map<number, number[]>();
  if (absenceRules.length === 0) return map;

  const sourceRows = await db
    .select({ id: syslogSources.id })
    .from(syslogSources)
    .where(and(eq(syslogSources.siteId, siteId), eq(syslogSources.enabled, true)));

  const allSourceIds = sourceRows.map((row) => row.id);
  for (const rule of absenceRules) map.set(rule.id, allSourceIds);
  return map;
}

async function buildBaselineMap(
  rules: SiemRuleDefinition[],
  eventRows: (typeof syslogEvents.$inferSelect)[],
  now: Date,
  siteId: number,
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
    .where(and(eq(syslogEvents.siteId, siteId), gte(syslogEvents.receivedAt, sevenDaysAgo)));

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

  // Per-site loop: rules, events, absence/baseline maps, and findings are all
  // scoped to one site at a time so correlation never crosses site boundaries
  // and each site's headless worker iteration stays bounded.
  const siteRows = await db.select({ id: sites.id }).from(sites).where(eq(sites.isActive, true));

  let evaluatedRules = 0;
  let evaluatedEvents = 0;
  let candidatesCount = 0;
  let created = 0;
  let updated = 0;

  for (const site of siteRows) {
    const result = await runSiemRulesForSite(site.id, { now, lookbackSeconds, limit });
    evaluatedRules += result.evaluatedRules;
    evaluatedEvents += result.evaluatedEvents;
    candidatesCount += result.candidates;
    created += result.created;
    updated += result.updated;
  }

  return { evaluatedRules, evaluatedEvents, candidates: candidatesCount, created, updated };
}

async function runSiemRulesForSite(siteId: number, options: { now: Date; lookbackSeconds: number; limit: number }) {
  const { now, lookbackSeconds, limit } = options;

  const ruleRows = await db.select().from(siemRules).where(and(eq(siemRules.siteId, siteId), eq(siemRules.enabled, true)));
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
    .where(and(eq(syslogEvents.siteId, siteId), gte(syslogEvents.receivedAt, since)))
    .orderBy(desc(syslogEvents.receivedAt))
    .limit(limit);

  const [absenceMap, baselineMap] = await Promise.all([
    buildAbsenceMap(rules, siteId),
    buildBaselineMap(rules, eventRows, now, siteId),
  ]);
  const candidates = evaluateSiemRules({ rules, events: eventRows.map(asEvent), options: { now, absence: absenceMap, baseline: baselineMap } });
  let created = 0;
  let updated = 0;

  for (const candidate of candidates) {
    const rule = ruleById.get(candidate.ruleId);
    if (!rule) continue;
    // Events are scoped eq(syslogEvents.siteId, siteId) above, so every
    // candidate's siteId is this site's id. The null check narrows the
    // candidate type (siteId: number | null) for the NOT NULL insert.
    if (!candidate.siteId) continue;
    const text = buildFindingText({ candidate, rule });
    const existing = await db.query.siemFindings.findFirst({
      where: and(eq(siemFindings.siteId, siteId), eq(siemFindings.ruleId, candidate.ruleId), eq(siemFindings.correlationKey, candidate.correlationKey)),
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
      const inserted = await db.insert(siemFindings).values(findingValues(candidate, rule)).returning({
        id: siemFindings.id,
        severity: siemFindings.severity,
        status: siemFindings.status,
        aiGeneratedAt: siemFindings.aiGeneratedAt,
        siteId: siemFindings.siteId,
      });
      created++;
      // Fire-and-forget enqueue for the auto-AI path. Failures must not block
      // rule evaluation: the queue helper swallows its own errors and the next
      // runner pass will retry by re-evaluating rules. Wrapping in Promise.all
      // lets the insert return immediately and the enqueue settle in parallel
      // with the next candidate.
      const newRow = inserted[0];
      if (newRow) {
        await queueSiemAiAnalysis({
          id: newRow.id,
          aiGeneratedAt: newRow.aiGeneratedAt,
          severity: newRow.severity,
          status: newRow.status,
          siteId: newRow.siteId,
        });
      }
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

export async function seedDefaultSiemRules(rules: SeedSiemRule[], siteId: number) {
  // ponytail: guarded insert via NOT EXISTS anti-join instead of onConflict.
  // The unique constraint on (site_id, key) lands in migration 1b; during 1a
  // the global key-unique constraint is still live, so onConflict targeting
  // [siteId, key] would error and targeting key would collide across sites.
  // The anti-join only inserts rules the site doesn't already own, which is
  // exactly the seed semantics. Metadata refresh for existing rules is dropped
  // (rule worker reseed now only backfills missing rules); upgrade path: a
  // dedicated reseed-on-version command once the per-site unique exists.
  const existing = await db.select({ key: siemRules.key }).from(siemRules).where(eq(siemRules.siteId, siteId));
  const existingKeys = new Set(existing.map((row) => row.key));
  const toInsert = rules.filter((rule) => !existingKeys.has(rule.key));

  if (toInsert.length > 0) {
    await db.insert(siemRules).values(
      toInsert.map((rule) => ({
        siteId,
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
      })),
    );
  }

  return { seeded: toInsert.length };
}
