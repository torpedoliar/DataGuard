import type { SiemRuleType, SiemSeverity } from "./types";

export type SiemRuleFieldMatch = {
  field: string;
  op: "eq" | "neq" | "regex";
  value: string;
};

export type SiemRuleSuppression = {
  field: string;
  value: string;
};

export type SiemRuleConditions = {
  normalizedTypes?: string[];
  outcomes?: string[];
  tags?: string[];
  fieldMatches?: SiemRuleFieldMatch[];
  suppressions?: SiemRuleSuppression[];
};

export type SiemRuleDefinition = {
  id: number;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: SiemSeverity;
  category: string;
  ruleType: SiemRuleType;
  conditions: SiemRuleConditions | Record<string, unknown>;
  groupBy: string[];
  threshold: number | null;
  windowSeconds: number | null;
  cooldownSeconds: number;
};

export type SiemRuleEvent = {
  id: number;
  receivedAt: Date;
  siteId: number | null;
  deviceId: number | null;
  sourceId: number | null;
  sourceIp: string;
  normalizedType: string | null;
  action: string | null;
  outcome: string | null;
  srcIp: string | null;
  srcPort: number | null;
  dstIp: string | null;
  dstPort: number | null;
  username: string | null;
  interfaceName: string | null;
  protocol: string | null;
  program: string | null;
  tags: string[];
};

export type SiemSourceBaseline = {
  sourceId: number;
  avgPerHour: number;
};

export type SiemIoc = {
  id: number;
  type: "ip" | "domain" | "hash";
  value: string;
  severity: SiemSeverity;
};

export type SiemAbsenceOptions = {
  now: Date;
  expectedSourceIds: number[];
};

export type SiemBaselineOptions = {
  now: Date;
  baselineBySource: Map<number, SiemSourceBaseline>;
  // Per-entity baselines (P2 mini-UEBA), keyed `entityKey:value` -> avg/hour.
  baselineByEntity?: Map<string, number>;
};

export type EvaluateSiemRulesOptions = {
  now?: Date;
  absence?: Map<number, number[]>;
  baseline?: SiemBaselineOptions;
  iocs?: SiemIoc[];
  // first_seen support: known (ruleId, groupKey) -> set of values already seen.
  // Values absent from the set are new and produce a finding.
  knownValues?: Map<string, Set<string>>;
};

export type SiemFindingCandidate = {
  ruleId: number;
  ruleKey: string;
  title: string;
  summary: string;
  severity: SiemSeverity;
  siteId: number | null;
  deviceId: number | null;
  sourceId: number | null;
  eventCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  sampleEventIds: number[];
  correlationKey: string;
};

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function conditions(rule: SiemRuleDefinition): SiemRuleConditions {
  return {
    normalizedTypes: stringArray(rule.conditions.normalizedTypes),
    outcomes: stringArray(rule.conditions.outcomes),
    tags: stringArray(rule.conditions.tags),
    fieldMatches: (Array.isArray(rule.conditions.fieldMatches) ? rule.conditions.fieldMatches : []) as SiemRuleFieldMatch[],
    suppressions: (Array.isArray(rule.conditions.suppressions) ? rule.conditions.suppressions : []) as SiemRuleSuppression[],
  };
}

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

export function eventMatchesRule(rule: SiemRuleDefinition, event: SiemRuleEvent) {
  const parsed = conditions(rule);

  if (parsed.suppressions?.length) {
    for (const supp of parsed.suppressions) {
      const val = groupValue(event, supp.field);
      if (val !== null && val !== undefined && String(val) === supp.value) {
        return false;
      }
    }
  }

  if (parsed.normalizedTypes?.length && (!event.normalizedType || !parsed.normalizedTypes.includes(event.normalizedType))) return false;
  if (parsed.outcomes?.length && (!event.outcome || !parsed.outcomes.includes(event.outcome))) return false;
  if (parsed.tags?.length && !parsed.tags.every((tag) => event.tags.includes(tag))) return false;

  if (parsed.fieldMatches?.length) {
    for (const fm of parsed.fieldMatches) {
      const val = groupValue(event, fm.field);
      const strVal = val !== null && val !== undefined ? String(val) : "";
      
      if (fm.op === "eq") {
        if (strVal !== fm.value) return false;
      } else if (fm.op === "neq") {
        if (strVal === fm.value) return false;
      } else if (fm.op === "regex") {
        try {
          const re = new RegExp(fm.value, "i");
          if (!re.test(strVal)) return false;
        } catch {
          return false;
        }
      }
    }
  }

  return true;
}

export function buildCorrelationKey(rule: SiemRuleDefinition, event: SiemRuleEvent) {
  const group = rule.groupBy.length > 0
    ? rule.groupBy.map((key) => `${key}:${groupValue(event, key) ?? "none"}`).join("|")
    : `event:${event.id}`;
  return `${rule.key}|${group}`;
}

function sortEvents(events: SiemRuleEvent[]) {
  return [...events].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
}

function groupEvents(rule: SiemRuleDefinition, events: SiemRuleEvent[]) {
  const groups = new Map<string, SiemRuleEvent[]>();
  for (const event of events) {
    const key = buildCorrelationKey(rule, event);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return groups;
}

function titleTarget(rule: SiemRuleDefinition, event: SiemRuleEvent) {
  const values = rule.groupBy.map((key) => groupValue(event, key)).filter((value) => value !== null && value !== undefined);
  return values.length ? String(values.join(" / ")) : event.sourceIp;
}

function candidateFromEvents(rule: SiemRuleDefinition, correlationKey: string, events: SiemRuleEvent[]): SiemFindingCandidate {
  const ordered = sortEvents(events);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  return {
    ruleId: rule.id,
    ruleKey: rule.key,
    title: `${rule.name}: ${titleTarget(rule, last)}`,
    summary: `${rule.description} Matched ${ordered.length} event(s) between ${first.receivedAt.toISOString()} and ${last.receivedAt.toISOString()}.`,
    severity: rule.severity,
    siteId: last.siteId,
    deviceId: last.deviceId,
    sourceId: last.sourceId,
    eventCount: ordered.length,
    firstSeenAt: first.receivedAt,
    lastSeenAt: last.receivedAt,
    sampleEventIds: ordered.slice(-10).map((event) => event.id),
    correlationKey,
  };
}

function thresholdWindow(events: SiemRuleEvent[], threshold: number, windowSeconds: number) {
  const ordered = sortEvents(events);
  const windowMs = windowSeconds * 1000;
  let best: SiemRuleEvent[] = [];

  for (let start = 0; start < ordered.length; start++) {
    const startTime = ordered[start].receivedAt.getTime();
    const windowEvents = ordered.filter((event) => event.receivedAt.getTime() >= startTime && event.receivedAt.getTime() - startTime <= windowMs);
    if (windowEvents.length >= threshold && windowEvents[windowEvents.length - 1].receivedAt.getTime() >= (best[best.length - 1]?.receivedAt.getTime() ?? 0)) best = windowEvents;
  }

  return best.length >= threshold ? best : [];
}

function evaluateSingleEvent(rule: SiemRuleDefinition, events: SiemRuleEvent[]) {
  return [...groupEvents(rule, events).entries()].map(([correlationKey, group]) => candidateFromEvents(rule, correlationKey, group));
}

function evaluateThreshold(rule: SiemRuleDefinition, events: SiemRuleEvent[]) {
  if (!rule.threshold || !rule.windowSeconds) return [];

  const candidates: SiemFindingCandidate[] = [];
  for (const [correlationKey, group] of groupEvents(rule, events)) {
    const windowEvents = thresholdWindow(group, rule.threshold, rule.windowSeconds);
    if (windowEvents.length > 0) candidates.push(candidateFromEvents(rule, correlationKey, windowEvents));
  }
  return candidates;
}

function evaluateSequence(rule: SiemRuleDefinition, events: SiemRuleEvent[]) {
  if (!rule.threshold || !rule.windowSeconds) return [];
  const types = conditions(rule).normalizedTypes ?? [];
  if (types.length < 2) return [];

  const candidates: SiemFindingCandidate[] = [];
  const windowMs = rule.windowSeconds * 1000;
  for (const [correlationKey, group] of groupEvents(rule, events)) {
    const ordered = sortEvents(group);
    for (const event of ordered) {
      if (event.normalizedType !== types[types.length - 1]) continue;
      const eventTime = event.receivedAt.getTime();
      const prior = ordered.filter((candidate) => candidate.normalizedType === types[0] && candidate.receivedAt.getTime() <= eventTime && eventTime - candidate.receivedAt.getTime() <= windowMs);
      if (prior.length >= rule.threshold) candidates.push(candidateFromEvents(rule, correlationKey, [...prior.slice(-rule.threshold), event]));
    }
  }
  return candidates;
}

export function evaluateSiemRules(input: {
  rules: SiemRuleDefinition[];
  events: SiemRuleEvent[];
  options?: EvaluateSiemRulesOptions;
}) {
  const candidates: SiemFindingCandidate[] = [];
  const now = input.options?.now ?? new Date();

  for (const rule of input.rules) {
    if (!rule.enabled) continue;

    if (rule.ruleType === "absence") {
      const expected = input.options?.absence?.get(rule.id) ?? [];
      candidates.push(...evaluateAbsence(rule, input.events, { now, expectedSourceIds: expected }));
      continue;
    }

    if (rule.ruleType === "baseline_anomaly") {
      const baselineOptions = input.options?.baseline ?? { baselineBySource: new Map<number, SiemSourceBaseline>() };
      candidates.push(...evaluateBaseline(rule, input.events, { now, ...baselineOptions }));
      continue;
    }

    if (rule.ruleType === "indicator_match") {
      candidates.push(...evaluateIndicatorMatch(rule, input.events, input.options?.iocs ?? []));
      continue;
    }

    if (rule.ruleType === "first_seen") {
      candidates.push(...evaluateFirstSeen(rule, input.events, input.options?.knownValues ?? new Map()));
      continue;
    }

    const matchingEvents = input.events.filter((event) => eventMatchesRule(rule, event));
    if (matchingEvents.length === 0) continue;

    if (rule.ruleType === "single_event") candidates.push(...evaluateSingleEvent(rule, matchingEvents));
    if (rule.ruleType === "threshold") candidates.push(...evaluateThreshold(rule, matchingEvents));
    if (rule.ruleType === "sequence") candidates.push(...evaluateSequence(rule, matchingEvents));
  }

  return candidates;
}

export function evaluateAbsence(rule: SiemRuleDefinition, events: SiemRuleEvent[], options: SiemAbsenceOptions): SiemFindingCandidate[] {
  if (!rule.enabled) return [];
  if (!rule.groupBy.includes("sourceId")) return [];
  if (options.expectedSourceIds.length === 0) return [];

  const windowMs = (rule.windowSeconds ?? 1800) * 1000;
  const cutoff = options.now.getTime() - windowMs;
  const presentSourceIds = new Set<number>();
  for (const event of events) {
    if (event.sourceId == null) continue;
    if (event.receivedAt.getTime() < cutoff) continue;
    if (eventMatchesRule(rule, event)) presentSourceIds.add(event.sourceId);
  }

  const candidates: SiemFindingCandidate[] = [];
  for (const sourceId of options.expectedSourceIds) {
    if (presentSourceIds.has(sourceId)) continue;
    const correlationKey = `${rule.key}|sourceId:${sourceId}`;
    candidates.push({
      ruleId: rule.id,
      ruleKey: rule.key,
      title: `${rule.name}: source #${sourceId}`,
      summary: `${rule.description} No events received from source #${sourceId} in the last ${rule.windowSeconds ?? 1800} seconds (as of ${options.now.toISOString()}).`,
      severity: rule.severity,
      siteId: null,
      deviceId: null,
      sourceId,
      eventCount: 0,
      firstSeenAt: options.now,
      lastSeenAt: options.now,
      sampleEventIds: [],
      correlationKey,
    });
  }
  return candidates;
}

export function evaluateBaseline(rule: SiemRuleDefinition, events: SiemRuleEvent[], options: SiemBaselineOptions): SiemFindingCandidate[] {
  if (!rule.enabled) return [];
  if (!rule.threshold) return [];
  if (!rule.windowSeconds) return [];

  // Per-entity mode (P2 mini-UEBA): groupBy keys other than sourceId make the
  // rule baseline on that field's value (e.g. username activity volume) instead
  // of per-source log volume. baselineByEntity supplies avg/hour per value.
  const entityKeys = rule.groupBy.filter((key) => key !== "sourceId");
  if (rule.groupBy.includes("sourceId") || (entityKeys.length > 0 && options.baselineByEntity !== undefined)) {
    if (entityKeys.length > 0 && options.baselineByEntity !== undefined) {
      return evaluateBaselineByEntity(rule, events, { now: options.now, baselineByEntity: options.baselineByEntity, entityKey: entityKeys[0] });
    }
    if (!rule.groupBy.includes("sourceId")) return [];
  }
  if (!rule.groupBy.includes("sourceId")) return [];

  const windowMs = (rule.windowSeconds ?? 900) * 1000;
  const windowHours = (rule.windowSeconds ?? 900) / 3600;
  const cutoff = options.now.getTime() - windowMs;
  const counts = new Map<number, number>();
  for (const event of events) {
    if (event.sourceId == null) continue;
    if (event.receivedAt.getTime() < cutoff) continue;
    if (eventMatchesRule(rule, event)) counts.set(event.sourceId, (counts.get(event.sourceId) ?? 0) + 1);
  }

  const candidates: SiemFindingCandidate[] = [];
  for (const [sourceId, baseline] of options.baselineBySource) {
    const current = counts.get(sourceId) ?? 0;
    const expectedMax = rule.threshold * baseline.avgPerHour * windowHours;
    if (current <= expectedMax) continue;
    const correlationKey = `${rule.key}|sourceId:${sourceId}`;
    const matched = events
      .filter((event) => event.sourceId === sourceId && event.receivedAt.getTime() >= cutoff && eventMatchesRule(rule, event))
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    const samples = matched.slice(-10);
    candidates.push({
      ruleId: rule.id,
      ruleKey: rule.key,
      title: `${rule.name}: source #${sourceId}`,
      summary: `${rule.description} ${current} event(s) in the last ${rule.windowSeconds ?? 900} seconds (baseline ${baseline.avgPerHour.toFixed(1)}/h, threshold ${rule.threshold}×).`,
      severity: rule.severity,
      siteId: null,
      deviceId: null,
      sourceId,
      eventCount: current,
      firstSeenAt: matched[0]?.receivedAt ?? options.now,
      lastSeenAt: matched[matched.length - 1]?.receivedAt ?? options.now,
      sampleEventIds: samples.map((event) => event.id),
      correlationKey,
    });
  }
  return candidates;
}

export type SiemEntityBaselineOptions = {
  now: Date;
  baselineByEntity: Map<string, number>;
  entityKey: string;
};

/**
 * Per-entity baseline (mini-UEBA): count events per entity value in the
 * window and compare against `threshold × avgPerHour × windowHours` for that
 * value. Statistical (not ML) — upgrade path is rolling stddev once enough
 * history accumulates. ponytail: mean-based, no variance model yet.
 */
export function evaluateBaselineByEntity(
  rule: SiemRuleDefinition,
  events: SiemRuleEvent[],
  options: SiemEntityBaselineOptions,
): SiemFindingCandidate[] {
  if (!rule.enabled) return [];
  if (!rule.threshold) return [];
  if (!rule.windowSeconds) return [];

  const windowMs = (rule.windowSeconds ?? 900) * 1000;
  const windowHours = (rule.windowSeconds ?? 900) / 3600;
  const cutoff = options.now.getTime() - windowMs;
  const counts = new Map<string, SiemRuleEvent[]>();
  for (const event of events) {
    const raw = groupValue(event, options.entityKey);
    if (raw === null || raw === undefined) continue;
    if (event.receivedAt.getTime() < cutoff) continue;
    if (!eventMatchesRule(rule, event)) continue;
    const key = String(raw);
    counts.set(key, [...(counts.get(key) ?? []), event]);
  }

  const candidates: SiemFindingCandidate[] = [];
  for (const [value, matched] of counts) {
    const avgPerHour = options.baselineByEntity.get(`${options.entityKey}:${value}`);
    if (avgPerHour === undefined) continue; // no baseline history — first_seen's job, not ours
    const expectedMax = rule.threshold * avgPerHour * windowHours;
    const current = matched.length;
    if (current <= expectedMax) continue;

    const ordered = sortEvents(matched);
    const samples = ordered.slice(-10);
    candidates.push({
      ruleId: rule.id,
      ruleKey: rule.key,
      title: `${rule.name}: ${value}`,
      summary: `${rule.description} ${current} event(s) for ${options.entityKey}=${value} in the last ${rule.windowSeconds ?? 900} seconds (baseline ${avgPerHour.toFixed(1)}/h, threshold ${rule.threshold}×).`,
      severity: rule.severity,
      siteId: ordered[ordered.length - 1]?.siteId ?? null,
      deviceId: ordered[ordered.length - 1]?.deviceId ?? null,
      sourceId: ordered[ordered.length - 1]?.sourceId ?? null,
      eventCount: current,
      firstSeenAt: ordered[0]?.receivedAt ?? options.now,
      lastSeenAt: ordered[ordered.length - 1]?.receivedAt ?? options.now,
      sampleEventIds: samples.map((event) => event.id),
      correlationKey: `${rule.key}|${options.entityKey}:${value}`,
    });
  }
  return candidates;
}

type IocMatch = { ioc: SiemIoc; field: string; value: string };

const IOC_FIELDS = ["srcIp", "dstIp", "sourceIp", "username", "program"] as const;

/**
 * Match an event's observable fields against IOC values. ip fields match
 * exactly; domain/hash values are compared case-insensitively. The username
 * and program fields are checked only against domain/hash IOCs — an IP IOC
 * never matches an account name.
 */
export function matchIoc(event: SiemRuleEvent, iocs: SiemIoc[]): IocMatch[] {
  if (iocs.length === 0) return [];
  const byValue = new Map<string, SiemIoc[]>();
  for (const ioc of iocs) {
    const key = ioc.type === "ip" ? ioc.value : ioc.value.toLowerCase();
    byValue.set(key, [...(byValue.get(key) ?? []), ioc]);
  }

  const matches: IocMatch[] = [];
  for (const field of IOC_FIELDS) {
    const raw = groupValue(event, field);
    if (raw === null || raw === undefined) continue;
    const value = String(raw);
    const candidates = byValue.get(value) ?? byValue.get(value.toLowerCase()) ?? [];
    for (const ioc of candidates) {
      if (ioc.type === "ip" && field === "username") continue;
      matches.push({ ioc, field, value });
    }
  }
  return matches;
}

export function evaluateIndicatorMatch(
  rule: SiemRuleDefinition,
  events: SiemRuleEvent[],
  iocs: SiemIoc[],
): SiemFindingCandidate[] {
  if (!rule.enabled || iocs.length === 0) return [];
  const candidates: SiemFindingCandidate[] = [];

  for (const event of events) {
    if (!eventMatchesRule(rule, event)) continue;
    const matches = matchIoc(event, iocs);
    if (matches.length === 0) continue;

    // One finding per event+IOC set. correlationKey includes the IOC values so
    // distinct indicators produce distinct findings, and repeat hits on the
    // same IOC merge into the existing finding via the upsert path.
    const iocLabels = [...new Set(matches.map((match) => `${match.ioc.type}:${match.ioc.value}`))].join(", ");
    const correlationKey = `${rule.key}|${iocLabels}`;
    const severity = matches.some((match) => match.ioc.severity === "Critical") ? "Critical" : rule.severity;
    const fields = matches.map((match) => `${match.field}=${match.value}`).join(", ");
    candidates.push({
      ruleId: rule.id,
      ruleKey: rule.key,
      title: `${rule.name}: ${iocLabels}`,
      summary: `${rule.description} Event #${event.id} from ${event.sourceIp} matched indicator(s) ${iocLabels} (field(s): ${fields}).`,
      severity,
      siteId: event.siteId,
      deviceId: event.deviceId,
      sourceId: event.sourceId,
      eventCount: 1,
      firstSeenAt: event.receivedAt,
      lastSeenAt: event.receivedAt,
      sampleEventIds: [event.id],
      correlationKey,
    });
  }
  return candidates;
}

export type SiemFirstSeenOptions = {
  knownValues: Map<string, Set<string>>;
};

/**
 * Generic first_seen: fire once per distinct value of the rule's groupBy
 * fields. The known-state key is `${ruleId}:${groupKey}`; the value set comes
 * from siem_seen_state (loaded per site by the runner). An event whose group
 * value was never seen produces a candidate; the runner then inserts the
 * state row so the same value doesn't fire again.
 *
 * Rules with no groupBy fields cannot track entity state — the runner treats
 * that as a misconfiguration and skips them.
 */
export function evaluateFirstSeen(
  rule: SiemRuleDefinition,
  events: SiemRuleEvent[],
  knownValues: Map<string, Set<string>>,
): SiemFindingCandidate[] {
  if (!rule.enabled || rule.groupBy.length === 0) return [];

  const candidates: SiemFindingCandidate[] = [];
  const emitted = new Set<string>();

  for (const event of events) {
    if (!eventMatchesRule(rule, event)) continue;

    const groupParts = rule.groupBy.map((key) => `${key}:${groupValue(event, key) ?? "none"}`);
    if (groupParts.some((part) => part.endsWith(":none"))) continue;
    const stateValue = groupParts.join("|");
    const stateKey = `${rule.id}:${rule.groupBy.join(",")}`;
    if (knownValues.get(stateKey)?.has(stateValue)) continue;
    // Same value appearing multiple times in this batch: one finding.
    if (emitted.has(stateValue)) continue;
    emitted.add(stateValue);

    const target = titleTarget(rule, event);
    candidates.push({
      ruleId: rule.id,
      ruleKey: rule.key,
      title: `${rule.name}: ${target}`,
      summary: `${rule.description} First observation of ${stateValue} (event #${event.id} from ${event.sourceIp} at ${event.receivedAt.toISOString()}).`,
      severity: rule.severity,
      siteId: event.siteId,
      deviceId: event.deviceId,
      sourceId: event.sourceId,
      eventCount: 1,
      firstSeenAt: event.receivedAt,
      lastSeenAt: event.receivedAt,
      sampleEventIds: [event.id],
      correlationKey: `${rule.key}|${stateValue}`,
    });
  }
  return candidates;
}
