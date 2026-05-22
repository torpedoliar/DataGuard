# SIEM Phase 08 Dashboard Alerting and Incident Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide SIEM dashboard, Telegram alert delivery audit, and create-incident workflow from findings.

**Architecture:** Add dashboard aggregate loaders in `actions/siem-dashboard.ts`, alert policy/send logic in `lib/siem/alerts.ts`, and incident conversion in `actions/siem-findings.ts`. Keep Telegram sends audited through `siem_alerts` before and after delivery.

**Tech Stack:** Next.js App Router/server actions, Drizzle ORM, PostgreSQL, existing Telegram helper, existing incidents schema/actions, Vitest, Tailwind CSS.

---

## File Structure

- Create `lib/siem/alerts.ts`: Telegram policy, message builder, audit send helper.
- Create `lib/siem/alerts.test.ts`: policy and message tests.
- Modify `scripts/siem-rule-worker.ts`: enqueue/send High/Critical alerts.
- Create `actions/siem-dashboard.ts`: dashboard cards and chart aggregates.
- Create `app/(dashboard)/admin/siem/page.tsx`: SIEM overview dashboard.
- Create `components/admin/siem-dashboard-cards.tsx`: KPI cards.
- Modify `actions/siem-findings.ts`: manual Telegram send and create incident from finding.
- Modify `components/admin/siem-finding-detail.tsx`: buttons/forms for Telegram and incident creation.

---

### Task 1: Alert Policy and Message Builder

**Files:**
- Create: `lib/siem/alerts.ts`
- Create: `lib/siem/alerts.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/siem/alerts.test.ts
import { describe, expect, it } from "vitest";
import { buildSiemTelegramMessage, shouldSendTelegramForFinding } from "./alerts";

describe("SIEM alert policy", () => {
  it("sends Critical immediately", () => {
    expect(shouldSendTelegramForFinding({ severity: "Critical", alertEnabled: false })).toBe(true);
  });

  it("sends High only when rule alert enabled", () => {
    expect(shouldSendTelegramForFinding({ severity: "High", alertEnabled: true })).toBe(true);
    expect(shouldSendTelegramForFinding({ severity: "High", alertEnabled: false })).toBe(false);
  });

  it("keeps Medium and Low dashboard-only", () => {
    expect(shouldSendTelegramForFinding({ severity: "Medium", alertEnabled: true })).toBe(false);
    expect(shouldSendTelegramForFinding({ severity: "Low", alertEnabled: true })).toBe(false);
  });
});

describe("buildSiemTelegramMessage", () => {
  it("renders required fields", () => {
    const message = buildSiemTelegramMessage({ severity: "Critical", title: "Failed login", siteName: "JKT", deviceName: "router01", sourceIp: "10.0.0.2", eventCount: 5, humanAnalysis: "Brute force", recommendedAction: "Block source" });
    expect(message).toContain("[SIEM Critical] Failed login");
    expect(message).toContain("Site: JKT");
    expect(message).toContain("Action:");
  });
});
```

- [ ] **Step 2: Run tests RED**

Run: `rtk npm run test -- lib/siem/alerts.test.ts`

Expected: FAIL because alert helper does not exist.

- [ ] **Step 3: Implement helper**

```ts
// lib/siem/alerts.ts
import type { SiemSeverity } from "./types";

export function shouldSendTelegramForFinding(input: { severity: SiemSeverity; alertEnabled: boolean }) {
  if (input.severity === "Critical") return true;
  if (input.severity === "High") return input.alertEnabled;
  return false;
}

function value(input: string | number | null | undefined) {
  const text = String(input ?? "").trim();
  return text || "-";
}

export function buildSiemTelegramMessage(input: { severity: SiemSeverity; title: string; siteName?: string | null; deviceName?: string | null; sourceIp?: string | null; eventCount: number; humanAnalysis?: string | null; recommendedAction?: string | null }) {
  return [
    `[SIEM ${input.severity}] ${input.title}`,
    "",
    `Site: ${value(input.siteName)}`,
    `Device: ${value(input.deviceName)}`,
    `Source: ${value(input.sourceIp)}`,
    `Events: ${input.eventCount}`,
    "",
    "Analisa:",
    value(input.humanAnalysis),
    "",
    "Action:",
    value(input.recommendedAction),
  ].join("\n");
}
```

- [ ] **Step 4: Run tests GREEN**

Run: `rtk npm run test -- lib/siem/alerts.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit alert helper**

Run:

```bash
rtk git add lib/siem/alerts.ts lib/siem/alerts.test.ts && rtk git commit -m "feat: add SIEM alert policy"
```

Expected: commit succeeds.

---

### Task 2: Alert Audit Send Integration

**Files:**
- Modify: `scripts/siem-rule-worker.ts`

- [ ] **Step 1: Import alert and Telegram helpers**

Add imports:

```ts
import { siemAlerts, sites, devices } from "../db/schema";
import { buildSiemTelegramMessage, shouldSendTelegramForFinding } from "../lib/siem/alerts";
import { sendTelegramAlert } from "../lib/telegram";
```

- [ ] **Step 2: Add send helper in worker**

```ts
async function sendFindingAlert(input: { findingId: number; ruleAlertEnabled: boolean; severity: "Low" | "Medium" | "High" | "Critical"; title: string; siteId: number | null; deviceId: number | null; sourceIp: string | null; eventCount: number; humanAnalysis: string | null; recommendedAction: string | null }) {
  if (!shouldSendTelegramForFinding({ severity: input.severity, alertEnabled: input.ruleAlertEnabled })) return;
  if (!input.siteId) return;
  const site = await db.query.sites.findFirst({ where: eq(sites.id, input.siteId) });
  if (!site?.telegramChatId) return;
  const device = input.deviceId ? await db.query.devices.findFirst({ where: eq(devices.id, input.deviceId) }) : null;
  const message = buildSiemTelegramMessage({ severity: input.severity, title: input.title, siteName: site.name, deviceName: device?.name, sourceIp: input.sourceIp, eventCount: input.eventCount, humanAnalysis: input.humanAnalysis, recommendedAction: input.recommendedAction });
  const [alert] = await db.insert(siemAlerts).values({ findingId: input.findingId, channel: "telegram", recipient: site.telegramChatId, status: "pending", message }).returning();
  const result = await sendTelegramAlert(site.telegramChatId, message);
  await db.update(siemAlerts).set({ status: result.success ? "sent" : "failed", sentAt: result.success ? new Date() : null, error: result.success ? null : result.message }).where(eq(siemAlerts.id, alert.id));
}
```

After finding insert returns a new finding, call `sendFindingAlert(...)`. Do not send again for existing finding updates in this task.

- [ ] **Step 3: Typecheck and commit**

Run:

```bash
rtk npx tsc --noEmit
rtk git add scripts/siem-rule-worker.ts && rtk git commit -m "feat: send audited SIEM Telegram alerts"
```

Expected: PASS and commit succeeds.

---

### Task 3: Dashboard Data and Page

**Files:**
- Create: `actions/siem-dashboard.ts`
- Create: `components/admin/siem-dashboard-cards.tsx`
- Create: `app/(dashboard)/admin/siem/page.tsx`

- [ ] **Step 1: Create dashboard action**

```ts
// actions/siem-dashboard.ts
"use server";

import { db } from "@/db";
import { siemFindings, syslogEvents, syslogEventsRaw, syslogSources } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";

export async function getSiemDashboard() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return null;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [events24h, openCritical, openHigh, unknownSources, parserErrors, topTypes] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(syslogEvents).where(and(eq(syslogEvents.siteId, auth.activeSiteId), gte(syslogEvents.receivedAt, since))),
    db.select({ count: sql<number>`count(*)` }).from(siemFindings).where(and(eq(siemFindings.siteId, auth.activeSiteId), eq(siemFindings.status, "Open"), eq(siemFindings.severity, "Critical"))),
    db.select({ count: sql<number>`count(*)` }).from(siemFindings).where(and(eq(siemFindings.siteId, auth.activeSiteId), eq(siemFindings.status, "Open"), eq(siemFindings.severity, "High"))),
    db.select({ count: sql<number>`count(*)` }).from(syslogSources).where(and(eq(syslogSources.siteId, auth.activeSiteId), isNull(syslogSources.deviceId))),
    db.select({ count: sql<number>`count(*)` }).from(syslogEventsRaw).where(and(eq(syslogEventsRaw.ingestStatus, "parse_failed"), gte(syslogEventsRaw.receivedAt, since))),
    db.select({ normalizedType: syslogEvents.normalizedType, count: sql<number>`count(*)` }).from(syslogEvents).where(and(eq(syslogEvents.siteId, auth.activeSiteId), gte(syslogEvents.receivedAt, since))).groupBy(syslogEvents.normalizedType).orderBy(desc(sql`count(*)`)).limit(5),
  ]);
  return { events24h: Number(events24h[0]?.count ?? 0), openCritical: Number(openCritical[0]?.count ?? 0), openHigh: Number(openHigh[0]?.count ?? 0), unknownSources: Number(unknownSources[0]?.count ?? 0), parserErrors: Number(parserErrors[0]?.count ?? 0), topTypes };
}
```

- [ ] **Step 2: Create card component and page**

```tsx
// components/admin/siem-dashboard-cards.tsx
type Dashboard = NonNullable<Awaited<ReturnType<typeof import("@/actions/siem-dashboard").getSiemDashboard>>>;
export default function SiemDashboardCards({ data }: { data: Dashboard }) {
  const cards = [
    ["Events last 24h", data.events24h],
    ["Open Critical", data.openCritical],
    ["Open High", data.openHigh],
    ["Unknown Sources", data.unknownSources],
    ["Parser Errors", data.parserErrors],
  ];
  return <div className="grid gap-3 md:grid-cols-5">{cards.map(([label, value]) => <div key={label} className="rounded-lg border border-ops-border bg-ops-surface p-4"><p className="text-xs uppercase tracking-[0.12em] text-ops-muted">{label}</p><p className="mt-2 text-2xl font-bold text-ops-text">{value}</p></div>)}</div>;
}
```

```tsx
// app/(dashboard)/admin/siem/page.tsx
import { getSiemDashboard } from "@/actions/siem-dashboard";
import SiemDashboardCards from "@/components/admin/siem-dashboard-cards";
import PageHeader from "@/components/ui/page-header";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { redirect } from "next/navigation";

export default async function SiemDashboardPage() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) redirect("/checklist");
  const data = await getSiemDashboard();
  if (!data) redirect("/checklist");
  return <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-6"><PageHeader eyebrow="Admin / SIEM" title="SIEM Dashboard" description="Syslog health, findings, and alert overview." /><SiemDashboardCards data={data} /></main>;
}
```

- [ ] **Step 3: Typecheck and commit**

Run:

```bash
rtk npx tsc --noEmit
rtk git add actions/siem-dashboard.ts components/admin/siem-dashboard-cards.tsx "app/(dashboard)/admin/siem/page.tsx" && rtk git commit -m "feat: add SIEM dashboard"
```

Expected: PASS and commit succeeds.

---

### Task 4: Incident Creation From Finding

**Files:**
- Modify: `actions/siem-findings.ts`
- Modify: `components/admin/siem-finding-detail.tsx`

- [ ] **Step 1: Add action**

Append to `actions/siem-findings.ts`:

```ts
import { calculateIncidentDueDate } from "@/lib/incidents";
import { incidentUpdates, incidents } from "@/db/schema";

export async function createIncidentFromSiemFinding(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };
  const findingId = Number(formData.get("findingId"));
  if (!findingId) return { message: "Invalid finding." };
  const finding = await db.query.siemFindings.findFirst({ where: and(eq(siemFindings.id, findingId), eq(siemFindings.siteId, auth.activeSiteId)) });
  if (!finding) return { message: "Finding not found." };
  if (!finding.deviceId) return { message: "Map source to device before creating incident." };
  if (finding.createdIncidentId) return { success: true, incidentId: finding.createdIncidentId };
  const [incident] = await db.insert(incidents).values({ siteId: auth.activeSiteId, deviceId: finding.deviceId, title: finding.title, description: [finding.summary, finding.humanAnalysis, `Sample events: ${(finding.sampleEventIds as number[]).join(", ")}`].filter(Boolean).join("\n\n"), severity: finding.severity, status: "Open", createdById: auth.session.userId, dueDate: calculateIncidentDueDate(finding.severity) }).returning();
  await db.insert(incidentUpdates).values({ incidentId: incident.id, authorId: auth.session.userId, updateType: "created", note: finding.recommendedAction ?? "Created from SIEM finding." });
  await db.update(siemFindings).set({ createdIncidentId: incident.id, updatedAt: new Date() }).where(eq(siemFindings.id, finding.id));
  revalidatePath("/admin/siem/findings");
  revalidatePath("/admin/incidents");
  return { success: true, incidentId: incident.id };
}
```

- [ ] **Step 2: Add form to detail component**

Inside `SiemFindingDetail`, above evidence section:

```tsx
<form action={createIncidentFromSiemFinding}>
  <input type="hidden" name="findingId" value={finding.id} />
  <button className="rounded bg-ops-accent px-3 py-2 text-sm font-bold text-slate-950">Create Incident</button>
</form>
```

Add import:

```ts
import { createIncidentFromSiemFinding } from "@/actions/siem-findings";
```

- [ ] **Step 3: Typecheck and commit**

Run:

```bash
rtk npx tsc --noEmit
rtk git add actions/siem-findings.ts components/admin/siem-finding-detail.tsx && rtk git commit -m "feat: create incidents from SIEM findings"
```

Expected: PASS and commit succeeds.

---

### Task 5: Phase 08 Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run alert tests**

Run: `rtk npm run test -- lib/siem/alerts.test.ts`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Manual dashboard/finding check**

Run: `rtk npm run dev`

Open `/admin/siem` and `/admin/siem/findings?findingId=<id>`.

Expected: dashboard cards render, High/Critical alert sends create `siem_alerts`, and Create Incident blocks unmapped findings but creates incident for mapped findings.
