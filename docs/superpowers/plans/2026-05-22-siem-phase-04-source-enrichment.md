# SIEM Phase 04 Source Mapping and Asset Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map syslog events to DC Check sites/devices and enrich normalized events with asset metadata.

**Architecture:** Put matching and metadata assembly in pure-ish `lib/siem/source-enrichment.ts` functions with injected data, then call them from the parser worker. Admin source management uses server actions in `actions/siem-sources.ts` and a focused UI under `/admin/siem/sources`.

**Tech Stack:** TypeScript, Drizzle ORM, Next.js App Router/server actions, Vitest, Tailwind CSS.

---

## File Structure

- Create `lib/siem/source-enrichment.ts`: matching priority and enrichment metadata builder.
- Create `lib/siem/source-enrichment.test.ts`: matching and metadata tests.
- Modify `scripts/siem-parser-worker.ts`: load source/device context, apply enrichment, update source counters.
- Create `actions/siem-sources.ts`: list, map, update, disable, and merge source actions.
- Create `components/admin/siem-source-table.tsx`: known/unknown/disabled source management UI.
- Create `app/(dashboard)/admin/siem/sources/page.tsx`: admin-only source page.

---

### Task 1: Source Matching Helper

**Files:**
- Create: `lib/siem/source-enrichment.ts`
- Create: `lib/siem/source-enrichment.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/siem/source-enrichment.test.ts
import { describe, expect, it } from "vitest";
import { buildAssetMetadata, matchSyslogSource } from "./source-enrichment";

const source = { id: 1, siteId: 10, deviceId: 100, sourceIp: "10.0.0.1", hostname: "src-host", vendor: "cisco" as const, parserProfile: "cisco" };
const device = { id: 100, siteId: 10, name: "core-sw", ipAddress: "10.0.0.1", assetCode: "AST-1", categoryName: "Switch", brandName: "Cisco", locationName: "MDF", rackName: "R1", rackPosition: 10, zone: "Core" };

describe("matchSyslogSource", () => {
  it("prefers explicit source IP over device IP", () => {
    expect(matchSyslogSource({ sourceIp: "10.0.0.1", hostname: "core-sw", sources: [source], devices: [{ ...device, id: 200 }] })).toMatchObject({ sourceId: 1, deviceId: 100, matchType: "source_ip" });
  });

  it("matches device IP when source mapping does not exist", () => {
    expect(matchSyslogSource({ sourceIp: "10.0.0.1", hostname: null, sources: [], devices: [device] })).toMatchObject({ sourceId: null, deviceId: 100, matchType: "device_ip" });
  });

  it("matches hostname when IP does not match", () => {
    expect(matchSyslogSource({ sourceIp: "10.0.0.9", hostname: "src-host", sources: [source], devices: [] })).toMatchObject({ sourceId: 1, deviceId: 100, matchType: "source_hostname" });
  });

  it("returns unknown when nothing matches", () => {
    expect(matchSyslogSource({ sourceIp: "10.0.0.9", hostname: null, sources: [], devices: [] })).toMatchObject({ sourceId: null, deviceId: null, matchType: "unknown" });
  });
});

describe("buildAssetMetadata", () => {
  it("includes device and site fields", () => {
    expect(buildAssetMetadata({ site: { id: 10, name: "Jakarta", code: "JKT" }, device })).toMatchObject({ siteName: "Jakarta", siteCode: "JKT", deviceName: "core-sw", assetCode: "AST-1", category: "Switch", brand: "Cisco", location: "MDF", rack: "R1", rackPosition: 10, zone: "Core" });
  });
});
```

- [ ] **Step 2: Run tests RED**

Run: `rtk npm run test -- lib/siem/source-enrichment.test.ts`

Expected: FAIL because helper file does not exist.

- [ ] **Step 3: Implement matching and metadata**

```ts
// lib/siem/source-enrichment.ts
export type SourceCandidate = { id: number; siteId: number | null; deviceId: number | null; sourceIp: string; hostname: string | null; vendor: string; parserProfile: string };
export type DeviceCandidate = { id: number; siteId: number | null; name: string; ipAddress: string | null; assetCode: string | null; categoryName: string | null; brandName: string | null; locationName: string | null; rackName: string | null; rackPosition: number | null; zone: string | null };
export type SiteCandidate = { id: number; name: string; code: string };

export function matchSyslogSource(input: { sourceIp: string; hostname: string | null; sources: SourceCandidate[]; devices: DeviceCandidate[] }) {
  const sourceByIp = input.sources.find((source) => source.sourceIp === input.sourceIp);
  if (sourceByIp) return { sourceId: sourceByIp.id, siteId: sourceByIp.siteId, deviceId: sourceByIp.deviceId, vendor: sourceByIp.vendor, parserProfile: sourceByIp.parserProfile, matchType: "source_ip" as const };

  const deviceByIp = input.devices.find((device) => device.ipAddress === input.sourceIp);
  if (deviceByIp) return { sourceId: null, siteId: deviceByIp.siteId, deviceId: deviceByIp.id, vendor: "generic", parserProfile: "generic", matchType: "device_ip" as const };

  const sourceByHostname = input.hostname ? input.sources.find((source) => source.hostname === input.hostname) : null;
  if (sourceByHostname) return { sourceId: sourceByHostname.id, siteId: sourceByHostname.siteId, deviceId: sourceByHostname.deviceId, vendor: sourceByHostname.vendor, parserProfile: sourceByHostname.parserProfile, matchType: "source_hostname" as const };

  const deviceByName = input.hostname ? input.devices.find((device) => device.name === input.hostname) : null;
  if (deviceByName) return { sourceId: null, siteId: deviceByName.siteId, deviceId: deviceByName.id, vendor: "generic", parserProfile: "generic", matchType: "device_name" as const };

  return { sourceId: null, siteId: null, deviceId: null, vendor: "generic", parserProfile: "generic", matchType: "unknown" as const };
}

export function buildAssetMetadata(input: { site: SiteCandidate | null; device: DeviceCandidate | null }) {
  return {
    siteName: input.site?.name ?? null,
    siteCode: input.site?.code ?? null,
    deviceName: input.device?.name ?? null,
    assetCode: input.device?.assetCode ?? null,
    category: input.device?.categoryName ?? null,
    brand: input.device?.brandName ?? null,
    location: input.device?.locationName ?? null,
    rack: input.device?.rackName ?? null,
    rackPosition: input.device?.rackPosition ?? null,
    zone: input.device?.zone ?? null,
  };
}
```

- [ ] **Step 4: Run tests GREEN**

Run: `rtk npm run test -- lib/siem/source-enrichment.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit enrichment helper**

Run:

```bash
rtk git add lib/siem/source-enrichment.ts lib/siem/source-enrichment.test.ts && rtk git commit -m "feat: add SIEM source matching"
```

Expected: commit succeeds.

---

### Task 2: Parser Worker Enrichment Integration

**Files:**
- Modify: `scripts/siem-parser-worker.ts`

- [ ] **Step 1: Load enrichment context in worker**

In `scripts/siem-parser-worker.ts`, import needed schema tables and helpers:

```ts
import { brands, categories, devices, locations, siemSettings, sites, syslogSources } from "../db/schema";
import { buildAssetMetadata, matchSyslogSource, type DeviceCandidate, type SourceCandidate } from "../lib/siem/source-enrichment";
```

Add helper functions above `runOnce()`:

```ts
async function loadContext() {
  const [sourceRows, deviceRows, siteRows, settingsRows] = await Promise.all([
    db.select().from(syslogSources),
    db.select({
      id: devices.id,
      siteId: devices.siteId,
      name: devices.name,
      ipAddress: devices.ipAddress,
      assetCode: devices.assetCode,
      categoryName: categories.name,
      brandName: brands.name,
      locationName: locations.name,
      rackName: devices.rackName,
      rackPosition: devices.rackPosition,
      zone: devices.zone,
    }).from(devices).leftJoin(categories, eq(devices.categoryId, categories.id)).leftJoin(brands, eq(devices.brandId, brands.id)).leftJoin(locations, eq(devices.locationId, locations.id)),
    db.select().from(sites),
    db.select().from(siemSettings).limit(1),
  ]);

  return {
    sources: sourceRows as SourceCandidate[],
    devices: deviceRows as DeviceCandidate[],
    sites: siteRows,
    settings: settingsRows[0] ?? null,
  };
}
```

- [ ] **Step 2: Apply match during insert**

Inside `runOnce()`, call `const context = await loadContext();` before loop.

For each raw row after `processed`, compute:

```ts
const match = matchSyslogSource({ sourceIp: raw.sourceIp, hostname: processed.hostname, sources: context.sources, devices: context.devices });
const siteId = match.siteId ?? context.settings?.defaultSiemSiteId ?? null;
const device = context.devices.find((candidate) => candidate.id === match.deviceId) ?? null;
const site = context.sites.find((candidate) => candidate.id === siteId) ?? null;
const metadata = { ...processed.metadata, enrichment: buildAssetMetadata({ site, device }), matchType: match.matchType };
```

Set these insert fields:

```ts
siteId,
deviceId: match.deviceId,
sourceId: match.sourceId,
vendor: match.vendor as "generic" | "mikrotik" | "cisco" | "fortigate" | "linux",
metadata,
```

- [ ] **Step 3: Update or create unknown source**

Before insert, if `match.matchType === "unknown" && context.settings?.unknownSourceEnabled && siteId`, insert source row with conflict-safe behavior:

```ts
const [createdSource] = await db.insert(syslogSources).values({
  siteId,
  sourceIp: raw.sourceIp,
  hostname: processed.hostname,
  displayName: processed.hostname ?? raw.sourceIp,
  vendor: "generic",
  parserProfile: "generic",
  lastSeenAt: new Date(),
  eventCount: 1,
}).onConflictDoNothing().returning();
```

Use `createdSource?.id ?? match.sourceId` for `sourceId`.

- [ ] **Step 4: Typecheck**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit worker enrichment**

Run:

```bash
rtk git add scripts/siem-parser-worker.ts && rtk git commit -m "feat: enrich parsed syslog events"
```

Expected: commit succeeds.

---

### Task 3: SIEM Source Server Actions

**Files:**
- Create: `actions/siem-sources.ts`

- [ ] **Step 1: Create actions file**

```ts
// actions/siem-sources.ts
"use server";

import { db } from "@/db";
import { devices, sites, syslogSources } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function getSiemSources() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return [];

  return await db.select({
    id: syslogSources.id,
    sourceIp: syslogSources.sourceIp,
    hostname: syslogSources.hostname,
    displayName: syslogSources.displayName,
    vendor: syslogSources.vendor,
    parserProfile: syslogSources.parserProfile,
    enabled: syslogSources.enabled,
    lastSeenAt: syslogSources.lastSeenAt,
    eventCount: syslogSources.eventCount,
    deviceId: syslogSources.deviceId,
    deviceName: devices.name,
    siteName: sites.name,
  }).from(syslogSources)
    .leftJoin(devices, eq(syslogSources.deviceId, devices.id))
    .leftJoin(sites, eq(syslogSources.siteId, sites.id))
    .where(eq(syslogSources.siteId, auth.activeSiteId))
    .orderBy(desc(syslogSources.lastSeenAt));
}

export async function mapSiemSource(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const sourceId = Number(formData.get("sourceId"));
  const deviceId = Number(formData.get("deviceId"));
  if (!sourceId || !deviceId) return { message: "Invalid source or device." };

  const device = await db.query.devices.findFirst({ where: and(eq(devices.id, deviceId), eq(devices.siteId, auth.activeSiteId)) });
  if (!device) return { message: "Device not found in active site." };

  await db.update(syslogSources).set({ deviceId, siteId: auth.activeSiteId, enabled: true, updatedAt: new Date() }).where(and(eq(syslogSources.id, sourceId), eq(syslogSources.siteId, auth.activeSiteId)));
  await logAudit({ action: "UPDATE", entity: "syslog_source", entityId: sourceId, entityName: device.name });
  revalidatePath("/admin/siem/sources");
  return { success: true };
}

export async function disableSiemSource(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };
  const sourceId = Number(formData.get("sourceId"));
  if (!sourceId) return { message: "Invalid source." };
  await db.update(syslogSources).set({ enabled: false, updatedAt: new Date() }).where(and(eq(syslogSources.id, sourceId), eq(syslogSources.siteId, auth.activeSiteId)));
  await logAudit({ action: "UPDATE", entity: "syslog_source", entityId: sourceId, entityName: "disabled" });
  revalidatePath("/admin/siem/sources");
  return { success: true };
}
```

- [ ] **Step 2: Typecheck**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Commit source actions**

Run:

```bash
rtk git add actions/siem-sources.ts && rtk git commit -m "feat: add SIEM source actions"
```

Expected: commit succeeds.

---

### Task 4: Source Management Page

**Files:**
- Create: `components/admin/siem-source-table.tsx`
- Create: `app/(dashboard)/admin/siem/sources/page.tsx`

- [ ] **Step 1: Create source table component**

```tsx
// components/admin/siem-source-table.tsx
"use client";

import { disableSiemSource, mapSiemSource } from "@/actions/siem-sources";
import { useActionState } from "react";

type SourceRow = Awaited<ReturnType<typeof import("@/actions/siem-sources").getSiemSources>>[number];
type DeviceOption = { id: number; name: string; ipAddress: string | null };

export default function SiemSourceTable({ sources, devices }: { sources: SourceRow[]; devices: DeviceOption[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-ops-border bg-ops-surface">
      <table className="w-full text-sm">
        <thead className="bg-ops-surface-raised text-left text-xs uppercase tracking-[0.12em] text-ops-muted">
          <tr><th className="p-3">Source</th><th className="p-3">Device</th><th className="p-3">Vendor</th><th className="p-3">Last seen</th><th className="p-3">Events</th><th className="p-3">Actions</th></tr>
        </thead>
        <tbody>
          {sources.map((source) => <SourceRowItem key={source.id} source={source} devices={devices} />)}
        </tbody>
      </table>
    </div>
  );
}

function SourceRowItem({ source, devices }: { source: SourceRow; devices: DeviceOption[] }) {
  const [, mapAction] = useActionState(mapSiemSource, null);
  const [, disableAction] = useActionState(disableSiemSource, null);
  return (
    <tr className="border-t border-ops-border">
      <td className="p-3"><div className="font-mono text-ops-text">{source.sourceIp}</div><div className="text-xs text-ops-muted">{source.hostname || source.displayName}</div></td>
      <td className="p-3 text-ops-text">{source.deviceName || "Unknown"}</td>
      <td className="p-3 text-ops-muted">{source.vendor} / {source.parserProfile}</td>
      <td className="p-3 text-ops-muted">{source.lastSeenAt ? new Date(source.lastSeenAt).toLocaleString() : "-"}</td>
      <td className="p-3 text-ops-muted">{source.eventCount}</td>
      <td className="p-3">
        <form action={mapAction} className="flex gap-2">
          <input type="hidden" name="sourceId" value={source.id} />
          <select name="deviceId" className="rounded border border-ops-border bg-ops-bg px-2 py-1 text-ops-text">
            {devices.map((device) => <option key={device.id} value={device.id}>{device.name}{device.ipAddress ? ` (${device.ipAddress})` : ""}</option>)}
          </select>
          <button className="rounded bg-ops-accent px-2 py-1 text-xs font-bold text-slate-950">Map</button>
        </form>
        <form action={disableAction} className="mt-2">
          <input type="hidden" name="sourceId" value={source.id} />
          <button className="text-xs text-red-300">Disable</button>
        </form>
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: Create admin page**

```tsx
// app/(dashboard)/admin/siem/sources/page.tsx
import { getSiemSources } from "@/actions/siem-sources";
import { getDevices } from "@/actions/master-data";
import SiemSourceTable from "@/components/admin/siem-source-table";
import PageHeader from "@/components/ui/page-header";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { redirect } from "next/navigation";

export default async function SiemSourcesPage() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) redirect("/checklist");
  const [sources, devices] = await Promise.all([getSiemSources(), getDevices()]);

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader eyebrow="Admin / SIEM" title="Syslog Sources" description="Map unknown syslog senders to DC Check devices." />
      <SiemSourceTable sources={sources} devices={devices.map((device) => ({ id: device.id, name: device.name, ipAddress: device.ipAddress }))} />
    </main>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 4: Commit source UI**

Run:

```bash
rtk git add "app/(dashboard)/admin/siem/sources/page.tsx" components/admin/siem-source-table.tsx && rtk git commit -m "feat: add SIEM source mapping UI"
```

Expected: commit succeeds.

---

### Task 5: Phase 04 Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run enrichment tests**

Run: `rtk npm run test -- lib/siem/source-enrichment.test.ts`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Manual UI check**

Run: `rtk npm run dev`

Open `/admin/siem/sources` as admin.

Expected: page renders sources table, unknown source can be mapped to a device, and disabled source action succeeds.
