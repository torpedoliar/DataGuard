# SIEM Phase 06 Rule Engine and Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evaluate normalized syslog events with the 26 default rules and create deduplicated SIEM findings.

**Architecture:** Keep rule matching pure in `lib/siem/rule-engine.ts`, finding upsert formatting in `lib/siem/finding-builder.ts`, and database polling in `scripts/siem-rule-worker.ts`. UI gets a basic admin findings list/detail so generated findings are inspectable before Phase 07/08 enhancements.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL JSONB, Vitest, Next.js server actions, RTK-wrapped commands.

---

## File Structure

- Create `lib/siem/rule-engine.ts`: single_event, threshold, sequence, absence, baseline_anomaly evaluators.
- Create `lib/siem/rule-engine.test.ts`: coverage for rule families and duplicate/cooldown behavior.
- Create `lib/siem/finding-builder.ts`: correlation key, title, summary, sample IDs.
- Create `lib/siem/finding-builder.test.ts`: deterministic key/sample tests.
- Create `actions/siem-findings.ts`: list/detail/status actions.
- Create `scripts/siem-rule-worker.ts`: worker loop to load rules/events and upsert findings.
- Modify `package.json`: add `siem:rules`.
- Create `components/admin/siem-finding-table.tsx`: basic findings table.
- Create `app/(dashboard)/admin/siem/findings/page.tsx`: basic findings route.

---

### Task 1: Finding Builder

**Files:**
- Create: `lib/siem/finding-builder.ts`
- Create: `lib/siem/finding-builder.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/siem/finding-builder.test.ts
import { describe, expect, it } from "vitest";
import { buildCorrelationKey, trimSampleEventIds } from "./finding-builder";

describe("finding builder", () => {
  it("builds stable correlation keys", () => {
    expect(buildCorrelationKey({ groupBy: ["deviceId", "srcIp", "username"], event: { deviceId: 10, srcIp: "1.1.1.1", username: "admin" } })).toBe("deviceId=10|srcIp=1.1.1.1|username=admin");
  });

  it("uses dash for missing group values", () => {
    expect(buildCorrelationKey({ groupBy: ["deviceId", "interfaceName"], event: { deviceId: 10 } })).toBe("deviceId=10|interfaceName=-");
  });

  it("keeps newest unique sample ids", () => {
    expect(trimSampleEventIds([1, 2, 3, 2, 4, 5, 6], 5)).toEqual([2, 3, 4, 5, 6]);
  });
});
```

- [ ] **Step 2: Run tests RED**

Run: `rtk npm run test -- lib/siem/finding-builder.test.ts`

Expected: FAIL because builder does not exist.

- [ ] **Step 3: Implement finding builder**

```ts
// lib/siem/finding-builder.ts
export function buildCorrelationKey(input: { groupBy: string[]; event: Record<string, unknown> }) {
  return input.groupBy.map((field) => `${field}=${String(input.event[field] ?? "-")}`).join("|");
}

export function trimSampleEventIds(ids: number[], limit = 10) {
  return [...new Set(ids)].slice(-limit);
}

export function buildFindingText(input: { ruleName: string; eventCount: number; windowSeconds: number | null }) {
  const windowText = input.windowSeconds ? ` in ${Math.round(input.windowSeconds / 60)} minutes` : "";
  return {
    title: input.ruleName,
    summary: `${input.ruleName} matched ${input.eventCount} event${input.eventCount === 1 ? "" : "s"}${windowText}.`,
  };
}
```

- [ ] **Step 4: Run tests GREEN**

Run: `rtk npm run test -- lib/siem/finding-builder.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit builder**

Run:

```bash
rtk git add lib/siem/finding-builder.ts lib/siem/finding-builder.test.ts && rtk git commit -m "feat: build SIEM finding keys"
```

Expected: commit succeeds.

---

### Task 2: Rule Engine Pure Evaluators

**Files:**
- Create: `lib/siem/rule-engine.ts`
- Create: `lib/siem/rule-engine.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/siem/rule-engine.test.ts
import { describe, expect, it } from "vitest";
import { evaluateRule } from "./rule-engine";

const baseRule = { id: 1, key: "auth.failed_login_spike", name: "Failed login spike", severity: "High" as const, ruleType: "threshold" as const, conditions: { normalizedTypes: ["auth_failed"] }, groupBy: ["deviceId", "srcIp", "username"], threshold: 3, windowSeconds: 300, cooldownSeconds: 300 };
const event = (id: number, normalizedType = "auth_failed") => ({ id, normalizedType, receivedAt: new Date(`2026-05-22T00:0${id}:00Z`), deviceId: 10, srcIp: "1.1.1.1", username: "admin" });

describe("evaluateRule", () => {
  it("creates threshold matches at threshold", () => {
    expect(evaluateRule(baseRule, [event(1), event(2), event(3)])).toHaveLength(1);
  });

  it("does not create threshold matches below threshold", () => {
    expect(evaluateRule(baseRule, [event(1), event(2)])).toHaveLength(0);
  });

  it("creates single event matches", () => {
    const rule = { ...baseRule, ruleType: "single_event" as const, threshold: null, groupBy: ["deviceId"] };
    expect(evaluateRule(rule, [event(1)])).toMatchObject([{ eventCount: 1, sampleEventIds: [1] }]);
  });

  it("creates sequence match for failed then success", () => {
    const rule = { ...baseRule, ruleType: "sequence" as const, conditions: { normalizedTypes: ["auth_failed", "auth_success"] }, threshold: 2 };
    expect(evaluateRule(rule, [event(1, "auth_failed"), event(2, "auth_failed"), event(3, "auth_success")])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests RED**

Run: `rtk npm run test -- lib/siem/rule-engine.test.ts`

Expected: FAIL because engine does not exist.

- [ ] **Step 3: Implement evaluator**

```ts
// lib/siem/rule-engine.ts
import { buildCorrelationKey } from "./finding-builder";
import type { SiemRuleType, SiemSeverity } from "./types";

export type RuleInput = { id: number; key: string; name: string; severity: SiemSeverity; ruleType: SiemRuleType; conditions: { normalizedTypes: string[]; tags?: string[] }; groupBy: string[]; threshold: number | null; windowSeconds: number | null; cooldownSeconds: number };
export type EventInput = { id: number; normalizedType: string | null; receivedAt: Date; [key: string]: unknown };
export type RuleMatch = { ruleId: number; ruleKey: string; ruleName: string; severity: SiemSeverity; correlationKey: string; eventCount: number; sampleEventIds: number[]; firstSeenAt: Date; lastSeenAt: Date; representativeEvent: EventInput };

function matchesConditions(rule: RuleInput, event: EventInput) {
  return rule.conditions.normalizedTypes.length === 0 || (event.normalizedType !== null && rule.conditions.normalizedTypes.includes(event.normalizedType));
}

function groupEvents(rule: RuleInput, events: EventInput[]) {
  const groups = new Map<string, EventInput[]>();
  for (const event of events.filter((candidate) => matchesConditions(rule, candidate))) {
    const key = buildCorrelationKey({ groupBy: rule.groupBy, event });
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return groups;
}

function toMatch(rule: RuleInput, correlationKey: string, events: EventInput[]): RuleMatch {
  const sorted = [...events].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  return { ruleId: rule.id, ruleKey: rule.key, ruleName: rule.name, severity: rule.severity, correlationKey, eventCount: sorted.length, sampleEventIds: sorted.map((event) => event.id).slice(-10), firstSeenAt: sorted[0].receivedAt, lastSeenAt: sorted[sorted.length - 1].receivedAt, representativeEvent: sorted[sorted.length - 1] };
}

export function evaluateRule(rule: RuleInput, events: EventInput[]): RuleMatch[] {
  const groups = groupEvents(rule, events);
  const matches: RuleMatch[] = [];

  for (const [correlationKey, group] of groups) {
    if (rule.ruleType === "single_event") {
      matches.push(...group.map((event) => toMatch(rule, correlationKey, [event])));
    }
    if (rule.ruleType === "threshold" && group.length >= (rule.threshold ?? 1)) matches.push(toMatch(rule, correlationKey, group));
    if (rule.ruleType === "sequence") {
      const types = group.map((event) => event.normalizedType);
      const required = rule.conditions.normalizedTypes;
      const hasSequence = required.every((type, index) => types.indexOf(type) !== -1 && (index === 0 || types.indexOf(type) > types.indexOf(required[index - 1])));
      if (hasSequence && group.length >= (rule.threshold ?? required.length)) matches.push(toMatch(rule, correlationKey, group));
    }
    if (rule.ruleType === "baseline_anomaly" && group.length >= (rule.threshold ?? 1)) matches.push(toMatch(rule, correlationKey, group));
  }

  return matches;
}
```

- [ ] **Step 4: Run tests GREEN**

Run: `rtk npm run test -- lib/siem/rule-engine.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit rule engine**

Run:

```bash
rtk git add lib/siem/rule-engine.ts lib/siem/rule-engine.test.ts && rtk git commit -m "feat: evaluate SIEM rules"
```

Expected: commit succeeds.

---

### Task 3: Rule Worker

**Files:**
- Create: `scripts/siem-rule-worker.ts`
- Modify: `package.json`

- [ ] **Step 1: Create worker script**

```ts
// scripts/siem-rule-worker.ts
#!/usr/bin/env tsx
import dotenv from "dotenv";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../db";
import { siemFindings, siemRules, syslogEvents } from "../db/schema";
import { buildFindingText, trimSampleEventIds } from "../lib/siem/finding-builder";
import { evaluateRule, type EventInput, type RuleInput } from "../lib/siem/rule-engine";

dotenv.config();

const pollIntervalMs = Number(process.env.SIEM_RULE_POLL_INTERVAL_MS ?? 30000);

async function runOnce() {
  const rules = await db.select().from(siemRules).where(eq(siemRules.enabled, true));
  let matchCount = 0;

  for (const rule of rules) {
    const since = new Date(Date.now() - (rule.windowSeconds ?? 3600) * 1000);
    const events = await db.select().from(syslogEvents).where(gte(syslogEvents.receivedAt, since)).orderBy(desc(syslogEvents.receivedAt)).limit(1000);
    const matches = evaluateRule({
      id: rule.id,
      key: rule.key,
      name: rule.name,
      severity: rule.severity,
      ruleType: rule.ruleType,
      conditions: rule.conditions as RuleInput["conditions"],
      groupBy: rule.groupBy,
      threshold: rule.threshold,
      windowSeconds: rule.windowSeconds,
      cooldownSeconds: rule.cooldownSeconds,
    }, events as EventInput[]);

    for (const match of matches) {
      const text = buildFindingText({ ruleName: match.ruleName, eventCount: match.eventCount, windowSeconds: rule.windowSeconds });
      const existing = await db.query.siemFindings.findFirst({ where: and(eq(siemFindings.ruleId, match.ruleId), eq(siemFindings.correlationKey, match.correlationKey)) });
      if (existing) {
        await db.update(siemFindings).set({ eventCount: existing.eventCount + match.eventCount, lastSeenAt: match.lastSeenAt, sampleEventIds: trimSampleEventIds([...(existing.sampleEventIds as number[]), ...match.sampleEventIds]), updatedAt: new Date() }).where(eq(siemFindings.id, existing.id));
      } else {
        await db.insert(siemFindings).values({ ruleId: match.ruleId, title: text.title, summary: text.summary, severity: match.severity, status: "Open", eventCount: match.eventCount, firstSeenAt: match.firstSeenAt, lastSeenAt: match.lastSeenAt, sampleEventIds: match.sampleEventIds, correlationKey: match.correlationKey, siteId: match.representativeEvent.siteId as number | null, deviceId: match.representativeEvent.deviceId as number | null, sourceId: match.representativeEvent.sourceId as number | null });
      }
      matchCount += 1;
    }
  }

  return matchCount;
}

async function loop() {
  while (true) {
    const count = await runOnce();
    if (count > 0) console.log(`SIEM rule worker produced ${count} matches`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

void loop().catch((error) => {
  console.error("SIEM rule worker failed", error);
  process.exit(1);
});
```

Modify `package.json` scripts:

```json
"siem:rules": "tsx scripts/siem-rule-worker.ts"
```

- [ ] **Step 2: Typecheck**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Commit worker**

Run:

```bash
rtk git add scripts/siem-rule-worker.ts package.json && rtk git commit -m "feat: add SIEM rule worker"
```

Expected: commit succeeds.

---

### Task 4: Findings Actions and Basic UI

**Files:**
- Create: `actions/siem-findings.ts`
- Create: `components/admin/siem-finding-table.tsx`
- Create: `app/(dashboard)/admin/siem/findings/page.tsx`

- [ ] **Step 1: Create findings actions**

```ts
// actions/siem-findings.ts
"use server";

import { db } from "@/db";
import { devices, siemFindings, siemRules } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function getSiemFindings() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return [];
  return await db.select({ id: siemFindings.id, title: siemFindings.title, summary: siemFindings.summary, severity: siemFindings.severity, status: siemFindings.status, eventCount: siemFindings.eventCount, lastSeenAt: siemFindings.lastSeenAt, deviceName: devices.name, ruleName: siemRules.name }).from(siemFindings).leftJoin(devices, eq(siemFindings.deviceId, devices.id)).leftJoin(siemRules, eq(siemFindings.ruleId, siemRules.id)).where(eq(siemFindings.siteId, auth.activeSiteId)).orderBy(desc(siemFindings.lastSeenAt));
}

export async function updateSiemFindingStatus(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };
  const findingId = Number(formData.get("findingId"));
  const status = String(formData.get("status"));
  if (!findingId || !["Open", "Acknowledged", "Resolved"].includes(status)) return { message: "Invalid finding status." };
  await db.update(siemFindings).set({ status: status as "Open" | "Acknowledged" | "Resolved", updatedAt: new Date(), acknowledgedBy: status === "Acknowledged" ? auth.session.userId : undefined, acknowledgedAt: status === "Acknowledged" ? new Date() : undefined, resolvedBy: status === "Resolved" ? auth.session.userId : undefined, resolvedAt: status === "Resolved" ? new Date() : undefined }).where(and(eq(siemFindings.id, findingId), eq(siemFindings.siteId, auth.activeSiteId)));
  revalidatePath("/admin/siem/findings");
  return { success: true };
}
```

- [ ] **Step 2: Create table component**

```tsx
// components/admin/siem-finding-table.tsx
"use client";

import { updateSiemFindingStatus } from "@/actions/siem-findings";
import { useActionState } from "react";

type FindingRow = Awaited<ReturnType<typeof import("@/actions/siem-findings").getSiemFindings>>[number];

export default function SiemFindingTable({ findings }: { findings: FindingRow[] }) {
  return <div className="overflow-hidden rounded-lg border border-ops-border bg-ops-surface"><table className="w-full text-sm"><thead className="bg-ops-surface-raised text-left text-xs uppercase tracking-[0.12em] text-ops-muted"><tr><th className="p-3">Finding</th><th className="p-3">Severity</th><th className="p-3">Status</th><th className="p-3">Events</th><th className="p-3">Last seen</th><th className="p-3">Action</th></tr></thead><tbody>{findings.map((finding) => <FindingItem key={finding.id} finding={finding} />)}</tbody></table></div>;
}

function FindingItem({ finding }: { finding: FindingRow }) {
  const [, action] = useActionState(updateSiemFindingStatus, null);
  return <tr className="border-t border-ops-border"><td className="p-3"><div className="font-bold text-ops-text">{finding.title}</div><div className="text-xs text-ops-muted">{finding.summary}</div></td><td className="p-3 text-ops-muted">{finding.severity}</td><td className="p-3 text-ops-muted">{finding.status}</td><td className="p-3 text-ops-muted">{finding.eventCount}</td><td className="p-3 text-ops-muted">{new Date(finding.lastSeenAt).toLocaleString()}</td><td className="p-3"><form action={action} className="flex gap-2"><input type="hidden" name="findingId" value={finding.id} /><select name="status" defaultValue={finding.status} className="rounded border border-ops-border bg-ops-bg px-2 py-1 text-ops-text"><option>Open</option><option>Acknowledged</option><option>Resolved</option></select><button className="rounded bg-ops-accent px-2 py-1 text-xs font-bold text-slate-950">Save</button></form></td></tr>;
}
```

- [ ] **Step 3: Create findings page**

```tsx
// app/(dashboard)/admin/siem/findings/page.tsx
import { getSiemFindings } from "@/actions/siem-findings";
import SiemFindingTable from "@/components/admin/siem-finding-table";
import PageHeader from "@/components/ui/page-header";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { redirect } from "next/navigation";

export default async function SiemFindingsPage() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) redirect("/checklist");
  const findings = await getSiemFindings();
  return <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-6"><PageHeader eyebrow="Admin / SIEM" title="Findings" description="Correlated SIEM findings from syslog events." /><SiemFindingTable findings={findings} /></main>;
}
```

- [ ] **Step 4: Typecheck and commit**

Run:

```bash
rtk npx tsc --noEmit
rtk git add actions/siem-findings.ts components/admin/siem-finding-table.tsx "app/(dashboard)/admin/siem/findings/page.tsx" && rtk git commit -m "feat: add SIEM findings workflow"
```

Expected: PASS and commit succeeds.

---

### Task 5: Phase 06 Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run tests**

Run: `rtk npm run test -- lib/siem/finding-builder.test.ts lib/siem/rule-engine.test.ts`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Manual worker check**

Run: `rtk npm run siem:rules`

Expected: rule worker creates or updates findings from matching normalized events and `/admin/siem/findings` renders them.
