import { db } from "../../db";
import { siemFindings, siemIocs, siemRules, siemSeenState, sites, syslogEvents, syslogSources } from "../../db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { queueSiemAiAnalysis } from "./ai-queue";
import { buildFindingText } from "./human-analysis";
import { evaluateSiemRules, type SiemFindingCandidate, type SiemIoc, type SiemRuleDefinition, type SiemRuleEvent, type SiemSourceBaseline } from "./rule-engine";
import type { SiemRuleType, SiemSeverity } from "./types";

export type SiemRuleRunnerOptions = {
  lookbackSeconds?: number;
  now?: Date;
  limit?: number;
};

export type SeedSiemRule = Omit<SiemRuleDefinition, "id"> & {
  alertEnabled?: boolean;
  // Mapping metadata (0049): optional so legacy seed shapes keep working.
  mitreTactics?: string[];
  mitreTechniques?: string[];
  isoControls?: string[];
};

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

/**
 * Per-entity baselines (P2 mini-UEBA) for baseline_anomaly rules whose
 * groupBy targets a non-sourceId key. avg/hour per `entityKey:value` over the
 * same 7-day history window as the source baseline.
 */
async function buildEntityBaselineMap(
  rules: SiemRuleDefinition[],
  siteId: number,
): Promise<Map<string, number>> {
  const entityRules = rules.filter((rule) => {
    if (rule.ruleType !== "baseline_anomaly") return false;
    const entityKeys = rule.groupBy.filter((key) => key !== "sourceId");
    return entityKeys.length > 0;
  });
  const map = new Map<string, number>();
  if (entityRules.length === 0) return map;

  const entityKeys = [...new Set(entityRules.flatMap((rule) => rule.groupBy.filter((key) => key !== "sourceId")))];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      srcIp: syslogEvents.srcIp,
      dstIp: syslogEvents.dstIp,
      username: syslogEvents.username,
      program: syslogEvents.program,
      receivedAt: syslogEvents.receivedAt,
    })
    .from(syslogEvents)
    .where(and(eq(syslogEvents.siteId, siteId), gte(syslogEvents.receivedAt, sevenDaysAgo)));

  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const key of entityKeys) {
      const raw = key === "username" ? row.username : key === "program" ? row.program : key === "dstIp" ? row.dstIp : key === "srcIp" ? row.srcIp : null;
      if (raw == null || raw === "") continue;
      const mapKey = `${key}:${String(raw)}`;
      counts.set(mapKey, (counts.get(mapKey) ?? 0) + 1);
    }
  }
  const hours = 7 * 24;
  for (const [mapKey, total] of counts) {
    if (total === 0) continue;
    map.set(mapKey, total / hours);
  }
  return map;
}

async function loadSiteIocs(siteId: number, now: Date): Promise<SiemIoc[]> {
  const rows = await db
    .select({ id: siemIocs.id, type: siemIocs.type, value: siemIocs.value, severity: siemIocs.severity, expiresAt: siemIocs.expiresAt })
    .from(siemIocs)
    .where(and(eq(siemIocs.siteId, siteId), eq(siemIocs.enabled, true)));
  const nowMs = now.getTime();
  return rows
    .filter((row) => {
      if (row.type !== "ip" && row.type !== "domain" && row.type !== "hash") return false;
      // Expired IOCs stop matching but stay in the table for audit/review.
      return row.expiresAt == null || row.expiresAt.getTime() > nowMs;
    })
    .map((row) => ({ id: row.id, type: row.type as SiemIoc["type"], value: row.value, severity: row.severity as SiemSeverity }));
}

/**
 * Load known entity values for the site's first_seen rules. State key mirrors
 * the engine: `${ruleId}:${groupKey}` -> set of `key:value|key:value` strings.
 */
async function buildKnownValuesMap(rules: SiemRuleDefinition[], siteId: number): Promise<Map<string, Set<string>>> {
  const firstSeenRules = rules.filter((rule) => rule.ruleType === "first_seen" && rule.groupBy.length > 0);
  const map = new Map<string, Set<string>>();
  if (firstSeenRules.length === 0) return map;

  const rows = await db
    .select({ ruleId: siemSeenState.ruleId, groupKey: siemSeenState.groupKey, groupValue: siemSeenState.groupValue })
    .from(siemSeenState)
    .where(eq(siemSeenState.siteId, siteId));

  const ruleIds = new Set(firstSeenRules.map((rule) => rule.id));
  for (const row of rows) {
    if (!ruleIds.has(row.ruleId)) continue;
    const stateKey = `${row.ruleId}:${row.groupKey}`;
    const set = map.get(stateKey) ?? new Set<string>();
    set.add(row.groupValue);
    map.set(stateKey, set);
  }
  return map;
}

/**
 * Record first sightings for first_seen candidates so the same entity value
 * doesn't fire again on the next pass. Upsert bumps last_seen/seen_count for
 * already-known values (cheap, and keeps the state honest about recency).
 */
async function recordSeenValues(siteId: number, rules: SiemRuleDefinition[], candidates: SiemFindingCandidate[], events: SiemRuleEvent[], now: Date): Promise<void> {
  const firstSeenRules = rules.filter((rule) => rule.ruleType === "first_seen" && rule.groupBy.length > 0);
  if (firstSeenRules.length === 0) return;
  const ruleById = new Map(firstSeenRules.map((rule) => [rule.id, rule]));
  const eventById = new Map(events.map((event) => [event.id, event]));

  for (const candidate of candidates) {
    const rule = ruleById.get(candidate.ruleId);
    if (!rule) continue;
    const sampleEventId = candidate.sampleEventIds[0];
    const event = sampleEventId !== undefined ? eventById.get(sampleEventId) : undefined;
    if (!event) continue;

    const groupParts = rule.groupBy.map((key) => `${key}:${groupValue(event, key) ?? "none"}`);
    if (groupParts.some((part) => part.endsWith(":none"))) continue;
    const groupValueText = groupParts.join("|");
    const groupKey = rule.groupBy.join(",");
    const seenAt = candidate.firstSeenAt;

    await db
      .insert(siemSeenState)
      .values({
        siteId,
        ruleId: rule.id,
        groupKey,
        groupValue: groupValueText,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        seenCount: 1,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [siemSeenState.siteId, siemSeenState.ruleId, siemSeenState.groupKey, siemSeenState.groupValue],
        set: { lastSeenAt: seenAt, seenCount: sql`${siemSeenState.seenCount} + 1`, updatedAt: now },
      });
  }
}

// Group-value lookup shared with the engine's first_seen bookkeeping.

function groupValue(event: SiemRuleEvent, key: string) {
  if (key === "deviceId") return event.deviceId;
  if (key === "sourceId") return event.sourceId;
  if (key === "sourceIp") return event.sourceIp;
  if (key === "srcIp") return event.srcIp;
  if (key === "srcPort") return event.srcPort;
  if (key === "dstIp") return event.dstIp;
  if (key === "dstPort") return event.dstPort;
  if (key === "username") return event.username;
  if (key === "interfaceName") return event.interfaceName;
  if (key === "program") return event.program;
  if (key === "protocol") return event.protocol;
  return null;
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

  const [absenceMap, baselineBySource, iocs, knownValues, baselineByEntity] = await Promise.all([
    buildAbsenceMap(rules, siteId),
    buildBaselineMap(rules, eventRows, now, siteId),
    loadSiteIocs(siteId, now),
    buildKnownValuesMap(rules, siteId),
    buildEntityBaselineMap(rules, siteId),
  ]);
  const candidates = evaluateSiemRules({ rules, events: eventRows.map(asEvent), options: { now, absence: absenceMap, baseline: { now, baselineBySource, baselineByEntity }, iocs, knownValues } });

  // Persist first sightings BEFORE creating findings so a concurrent pass can't
  // double-fire the same entity; a failed finding insert leaves the state row,
  // which only loses one finding, not the dedupe guarantee.
  await recordSeenValues(siteId, rules, candidates, eventRows.map(asEvent), now);
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
        mitreTactics: rule.mitreTactics ?? [],
        mitreTechniques: rule.mitreTechniques ?? [],
        isoControls: rule.isoControls ?? [],
      })),
    );
  }

  return { seeded: toInsert.length };
}
