# SIEM Phase 05 Event Explorer UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-only UI for searching, filtering, and inspecting raw and normalized syslog events, including a safe Injection Inspector.

**Architecture:** Build query construction and injection detection as pure utilities, expose event data through `actions/siem-events.ts`, and render table/detail components under `/admin/siem/events`. Raw messages always render as text and never use `dangerouslySetInnerHTML`.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Drizzle ORM, Vitest, Tailwind CSS.

---

## File Structure

- Create `lib/siem/event-filters.ts`: filter parsing and SQL-safe query condition builder.
- Create `lib/siem/event-filters.test.ts`: filter, search escaping, pagination tests.
- Create `lib/siem/injection-inspector.ts`: XSS/HTML-like payload detection and decoded text preview.
- Create `lib/siem/injection-inspector.test.ts`: detection tests.
- Create `actions/siem-events.ts`: event list/detail loaders and manual finding/source mapping entrypoints if needed.
- Create `components/admin/siem-event-table.tsx`: event table.
- Create `components/admin/siem-event-filters.tsx`: filter form.
- Create `components/admin/siem-event-detail.tsx`: detail tabs Raw/Parsed/Injection Inspector.
- Create `app/(dashboard)/admin/siem/events/page.tsx`: event explorer page.

---

### Task 1: Injection Inspector Utility

**Files:**
- Create: `lib/siem/injection-inspector.ts`
- Create: `lib/siem/injection-inspector.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/siem/injection-inspector.test.ts
import { describe, expect, it } from "vitest";
import { inspectInjectionRisk } from "./injection-inspector";

describe("inspectInjectionRisk", () => {
  it("flags script tags as dangerous", () => {
    expect(inspectInjectionRisk("<script>alert(1)</script>")).toMatchObject({ risk: "dangerous", matches: expect.arrayContaining(["script_tag"]) });
  });

  it("flags event handler attributes as dangerous", () => {
    expect(inspectInjectionRisk('<img src=x onerror="alert(1)">')).toMatchObject({ risk: "dangerous", matches: expect.arrayContaining(["event_handler"]) });
  });

  it("flags encoded HTML as suspicious and decodes preview as text", () => {
    expect(inspectInjectionRisk("&lt;iframe src=x&gt;")).toMatchObject({ risk: "suspicious", decodedPreview: "<iframe src=x>" });
  });

  it("marks normal syslog as none", () => {
    expect(inspectInjectionRisk("interface ether1 link down")).toMatchObject({ risk: "none", matches: [] });
  });
});
```

- [ ] **Step 2: Run tests RED**

Run: `rtk npm run test -- lib/siem/injection-inspector.test.ts`

Expected: FAIL because utility does not exist.

- [ ] **Step 3: Implement inspector**

```ts
// lib/siem/injection-inspector.ts
export type InjectionRisk = "none" | "suspicious" | "dangerous";

export function decodeHtmlEntities(value: string) {
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

export function inspectInjectionRisk(raw: string) {
  const decodedPreview = decodeHtmlEntities(raw);
  const matches: string[] = [];
  const target = decodedPreview;

  if (/<script\b/i.test(target)) matches.push("script_tag");
  if (/\son[a-z]+\s*=/i.test(target)) matches.push("event_handler");
  if (/javascript\s*:/i.test(target)) matches.push("javascript_url");
  if (/<iframe\b/i.test(target)) matches.push("iframe_tag");
  if (/<[a-z][\s\S]*>/i.test(target)) matches.push("html_like_payload");

  const encoded = decodedPreview !== raw;
  const dangerous = matches.some((match) => match !== "html_like_payload") && !encoded;
  const risk: InjectionRisk = dangerous ? "dangerous" : matches.length > 0 || encoded ? "suspicious" : "none";

  return { risk, matches: [...new Set(matches)], decodedPreview };
}
```

- [ ] **Step 4: Run tests GREEN**

Run: `rtk npm run test -- lib/siem/injection-inspector.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit inspector**

Run:

```bash
rtk git add lib/siem/injection-inspector.ts lib/siem/injection-inspector.test.ts && rtk git commit -m "feat: add safe syslog injection inspector"
```

Expected: commit succeeds.

---

### Task 2: Event Filter Query Utility

**Files:**
- Create: `lib/siem/event-filters.ts`
- Create: `lib/siem/event-filters.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/siem/event-filters.test.ts
import { describe, expect, it } from "vitest";
import { parseEventFilters, sanitizeSearchText } from "./event-filters";

describe("event filters", () => {
  it("parses valid filters", () => {
    expect(parseEventFilters({ severity: "3", page: "2", text: " failed%_ " })).toMatchObject({ severity: 3, page: 2, text: "failed%_" });
  });

  it("defaults invalid page to one", () => {
    expect(parseEventFilters({ page: "bad" }).page).toBe(1);
  });

  it("escapes LIKE wildcards", () => {
    expect(sanitizeSearchText("100%_match\\test")).toBe("100\\%\\_match\\\\test");
  });
});
```

- [ ] **Step 2: Run tests RED**

Run: `rtk npm run test -- lib/siem/event-filters.test.ts`

Expected: FAIL because utility does not exist.

- [ ] **Step 3: Implement filters**

```ts
// lib/siem/event-filters.ts
export type EventFilters = {
  page: number;
  pageSize: number;
  text: string | null;
  severity: number | null;
  facility: number | null;
  sourceIp: string | null;
  hostname: string | null;
  normalizedType: string | null;
  category: string | null;
  parser: string | null;
  injectionRisk: "none" | "suspicious" | "dangerous" | null;
};

function readString(input: Record<string, string | string[] | undefined>, key: string) {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(input: Record<string, string | string[] | undefined>, key: string) {
  const value = Number(readString(input, key));
  return Number.isFinite(value) ? value : null;
}

export function sanitizeSearchText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function parseEventFilters(input: Record<string, string | string[] | undefined>): EventFilters {
  const page = Number(readString(input, "page"));
  const risk = readString(input, "injectionRisk");
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: 50,
    text: readString(input, "text"),
    severity: readNumber(input, "severity"),
    facility: readNumber(input, "facility"),
    sourceIp: readString(input, "sourceIp"),
    hostname: readString(input, "hostname"),
    normalizedType: readString(input, "normalizedType"),
    category: readString(input, "category"),
    parser: readString(input, "parser"),
    injectionRisk: risk === "none" || risk === "suspicious" || risk === "dangerous" ? risk : null,
  };
}
```

- [ ] **Step 4: Run tests GREEN**

Run: `rtk npm run test -- lib/siem/event-filters.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit filter utilities**

Run:

```bash
rtk git add lib/siem/event-filters.ts lib/siem/event-filters.test.ts && rtk git commit -m "feat: add SIEM event filters"
```

Expected: commit succeeds.

---

### Task 3: Event Actions

**Files:**
- Create: `actions/siem-events.ts`

- [ ] **Step 1: Create event loaders**

```ts
// actions/siem-events.ts
"use server";

import { db } from "@/db";
import { devices, siemFindings, sites, syslogEvents, syslogEventsRaw } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { parseEventFilters, sanitizeSearchText } from "@/lib/siem/event-filters";
import { inspectInjectionRisk } from "@/lib/siem/injection-inspector";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

export async function getSiemEvents(searchParams: Record<string, string | string[] | undefined>) {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { events: [], filters: parseEventFilters(searchParams), total: 0 };
  const filters = parseEventFilters(searchParams);
  const conditions: SQL[] = [eq(syslogEvents.siteId, auth.activeSiteId)];
  if (filters.severity !== null) conditions.push(eq(syslogEvents.severity, filters.severity));
  if (filters.facility !== null) conditions.push(eq(syslogEvents.facility, filters.facility));
  if (filters.sourceIp) conditions.push(eq(syslogEvents.sourceIp, filters.sourceIp));
  if (filters.hostname) conditions.push(eq(syslogEvents.hostname, filters.hostname));
  if (filters.normalizedType) conditions.push(eq(syslogEvents.normalizedType, filters.normalizedType));
  if (filters.category) conditions.push(eq(syslogEvents.category, filters.category));
  if (filters.parser) conditions.push(eq(syslogEvents.parser, filters.parser));
  if (filters.text) {
    const text = `%${sanitizeSearchText(filters.text)}%`;
    conditions.push(or(ilike(syslogEvents.message, text), ilike(syslogEventsRaw.rawMessage, text))!);
  }

  const rows = await db.select({
    id: syslogEvents.id,
    receivedAt: syslogEvents.receivedAt,
    eventTime: syslogEvents.eventTime,
    siteName: sites.name,
    deviceName: devices.name,
    sourceIp: syslogEvents.sourceIp,
    hostname: syslogEvents.hostname,
    severity: syslogEvents.severity,
    facility: syslogEvents.facility,
    category: syslogEvents.category,
    normalizedType: syslogEvents.normalizedType,
    parser: syslogEvents.parser,
    message: syslogEvents.message,
    rawMessage: syslogEventsRaw.rawMessage,
  }).from(syslogEvents)
    .innerJoin(syslogEventsRaw, eq(syslogEvents.rawEventId, syslogEventsRaw.id))
    .leftJoin(sites, eq(syslogEvents.siteId, sites.id))
    .leftJoin(devices, eq(syslogEvents.deviceId, devices.id))
    .where(and(...conditions))
    .orderBy(desc(syslogEvents.receivedAt), desc(syslogEvents.id))
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  const events = rows
    .map((row) => ({ ...row, injection: inspectInjectionRisk(row.rawMessage) }))
    .filter((row) => !filters.injectionRisk || row.injection.risk === filters.injectionRisk);

  return { events, filters, total: events.length };
}

export async function getSiemEventDetail(eventId: number) {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return null;

  const event = await db.query.syslogEvents.findFirst({ where: and(eq(syslogEvents.id, eventId), eq(syslogEvents.siteId, auth.activeSiteId)), with: { rawEvent: true, device: true, source: true } });
  if (!event) return null;
  const relatedFindings = await db.select().from(siemFindings).where(sql`${siemFindings.sampleEventIds} @> ${JSON.stringify([eventId])}::jsonb`);
  return { ...event, injection: inspectInjectionRisk(event.rawEvent.rawMessage), relatedFindings };
}
```

- [ ] **Step 2: Typecheck**

Run: `rtk npx tsc --noEmit`

Expected: If relation names are missing from Phase 01, add `syslogEventsRelations` for raw/device/source and rerun until PASS.

- [ ] **Step 3: Commit actions**

Run:

```bash
rtk git add actions/siem-events.ts db/schema.ts && rtk git commit -m "feat: add SIEM event loaders"
```

Expected: commit succeeds.

---

### Task 4: Event Explorer UI

**Files:**
- Create: `components/admin/siem-event-filters.tsx`
- Create: `components/admin/siem-event-table.tsx`
- Create: `components/admin/siem-event-detail.tsx`
- Create: `app/(dashboard)/admin/siem/events/page.tsx`

- [ ] **Step 1: Create filters component**

```tsx
// components/admin/siem-event-filters.tsx
export default function SiemEventFilters({ filters }: { filters: { text: string | null; sourceIp: string | null; injectionRisk: string | null } }) {
  return (
    <form className="grid gap-3 rounded-lg border border-ops-border bg-ops-surface p-4 md:grid-cols-4">
      <input name="text" defaultValue={filters.text ?? ""} placeholder="Search raw/message" className="rounded border border-ops-border bg-ops-bg px-3 py-2 text-sm text-ops-text" />
      <input name="sourceIp" defaultValue={filters.sourceIp ?? ""} placeholder="Source IP" className="rounded border border-ops-border bg-ops-bg px-3 py-2 text-sm text-ops-text" />
      <select name="injectionRisk" defaultValue={filters.injectionRisk ?? ""} className="rounded border border-ops-border bg-ops-bg px-3 py-2 text-sm text-ops-text">
        <option value="">Any injection risk</option>
        <option value="none">None</option>
        <option value="suspicious">Suspicious</option>
        <option value="dangerous">Dangerous</option>
      </select>
      <button className="rounded bg-ops-accent px-3 py-2 text-sm font-bold text-slate-950">Filter</button>
    </form>
  );
}
```

- [ ] **Step 2: Create event table**

```tsx
// components/admin/siem-event-table.tsx
import Link from "next/link";

type EventRow = Awaited<ReturnType<typeof import("@/actions/siem-events").getSiemEvents>>["events"][number];

export default function SiemEventTable({ events }: { events: EventRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-ops-border bg-ops-surface">
      <table className="w-full text-sm">
        <thead className="bg-ops-surface-raised text-left text-xs uppercase tracking-[0.12em] text-ops-muted">
          <tr><th className="p-3">Received</th><th className="p-3">Source</th><th className="p-3">Severity</th><th className="p-3">Type</th><th className="p-3">Message</th><th className="p-3">Injection</th></tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-t border-ops-border">
              <td className="p-3 text-ops-muted">{new Date(event.receivedAt).toLocaleString()}</td>
              <td className="p-3"><div className="font-mono text-ops-text">{event.sourceIp}</div><div className="text-xs text-ops-muted">{event.deviceName || event.hostname || "Unknown"}</div></td>
              <td className="p-3 text-ops-muted">{event.severity ?? "-"}</td>
              <td className="p-3 text-ops-muted">{event.normalizedType || event.category || "-"}</td>
              <td className="max-w-xl truncate p-3 text-ops-text"><Link href={`/admin/siem/events?eventId=${event.id}`}>{event.message}</Link></td>
              <td className="p-3 text-ops-muted">{event.injection.risk}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Create detail component**

```tsx
// components/admin/siem-event-detail.tsx
import { inspectInjectionRisk } from "@/lib/siem/injection-inspector";

type EventDetail = NonNullable<Awaited<ReturnType<typeof import("@/actions/siem-events").getSiemEventDetail>>>;

export default function SiemEventDetail({ event }: { event: EventDetail }) {
  const raw = event.rawEvent.rawMessage;
  const injection = inspectInjectionRisk(raw);
  return (
    <section className="grid gap-4 rounded-lg border border-ops-border bg-ops-surface p-4">
      <h2 className="text-lg font-bold text-ops-text">Event #{event.id}</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        <div><h3 className="mb-2 font-semibold text-ops-text">Raw</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-ops-bg p-3 text-xs text-ops-text">{raw}</pre></div>
        <div><h3 className="mb-2 font-semibold text-ops-text">Parsed</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-ops-bg p-3 text-xs text-ops-text">{JSON.stringify(event, null, 2)}</pre></div>
        <div><h3 className="mb-2 font-semibold text-ops-text">Injection Inspector</h3><div className="rounded bg-ops-bg p-3 text-sm text-ops-text"><p>Risk: {injection.risk}</p><p>Matches: {injection.matches.join(", ") || "-"}</p><pre className="mt-3 whitespace-pre-wrap text-xs">{injection.decodedPreview}</pre></div></div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create page**

```tsx
// app/(dashboard)/admin/siem/events/page.tsx
import { getSiemEventDetail, getSiemEvents } from "@/actions/siem-events";
import SiemEventDetail from "@/components/admin/siem-event-detail";
import SiemEventFilters from "@/components/admin/siem-event-filters";
import SiemEventTable from "@/components/admin/siem-event-table";
import PageHeader from "@/components/ui/page-header";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { redirect } from "next/navigation";

export default async function SiemEventsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) redirect("/checklist");
  const params = await searchParams;
  const eventId = Number(params.eventId);
  const [{ events, filters }, detail] = await Promise.all([getSiemEvents(params), eventId ? getSiemEventDetail(eventId) : Promise.resolve(null)]);

  return (
    <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader eyebrow="Admin / SIEM" title="Event Explorer" description="Search raw and normalized syslog events." />
      <SiemEventFilters filters={filters} />
      <SiemEventTable events={events} />
      {detail && <SiemEventDetail event={detail} />}
    </main>
  );
}
```

- [ ] **Step 5: Typecheck and commit UI**

Run:

```bash
rtk npx tsc --noEmit
rtk git add "app/(dashboard)/admin/siem/events/page.tsx" components/admin/siem-event-*.tsx && rtk git commit -m "feat: add SIEM event explorer"
```

Expected: typecheck passes and commit succeeds.

---

### Task 5: Phase 05 Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run tests**

Run: `rtk npm run test -- lib/siem/injection-inspector.test.ts lib/siem/event-filters.test.ts`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Manual UI check**

Run: `rtk npm run dev`

Open `/admin/siem/events` as admin.

Expected: table renders, filters submit, event detail shows raw text, parsed JSON, and Injection Inspector. Raw payload `<script>alert(1)</script>` displays as text and does not execute.
