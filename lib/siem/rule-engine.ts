import type { SiemRuleType, SiemSeverity } from "./types";

export type SiemRuleConditions = {
  normalizedTypes?: string[];
  outcomes?: string[];
  tags?: string[];
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
  };
}

export function eventMatchesRule(rule: SiemRuleDefinition, event: SiemRuleEvent) {
  const parsed = conditions(rule);
  if (parsed.normalizedTypes?.length && (!event.normalizedType || !parsed.normalizedTypes.includes(event.normalizedType))) return false;
  if (parsed.outcomes?.length && (!event.outcome || !parsed.outcomes.includes(event.outcome))) return false;
  if (parsed.tags?.length && !parsed.tags.every((tag) => event.tags.includes(tag))) return false;
  return true;
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

export function evaluateSiemRules(input: { rules: SiemRuleDefinition[]; events: SiemRuleEvent[] }) {
  const candidates: SiemFindingCandidate[] = [];

  for (const rule of input.rules) {
    if (!rule.enabled) continue;
    if (rule.ruleType === "absence" || rule.ruleType === "baseline_anomaly") continue;

    const matchingEvents = input.events.filter((event) => eventMatchesRule(rule, event));
    if (matchingEvents.length === 0) continue;

    if (rule.ruleType === "single_event") candidates.push(...evaluateSingleEvent(rule, matchingEvents));
    if (rule.ruleType === "threshold") candidates.push(...evaluateThreshold(rule, matchingEvents));
    if (rule.ruleType === "sequence") candidates.push(...evaluateSequence(rule, matchingEvents));
  }

  return candidates;
}
