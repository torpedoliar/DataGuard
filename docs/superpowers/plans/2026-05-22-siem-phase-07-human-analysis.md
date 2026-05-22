# SIEM Phase 07 Human-Readable Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn SIEM findings into clear operator-readable analysis and recommended actions for all 26 default rules.

**Architecture:** Use deterministic rule-key templates in `lib/siem/human-analysis.ts`, run them when findings are created/updated, and show analysis/evidence in the findings UI. No AI is involved in this phase.

**Tech Stack:** TypeScript, Vitest, Drizzle ORM, Next.js App Router, Tailwind CSS.

---

## File Structure

- Create `lib/siem/human-analysis.ts`: rule-key template map and safe interpolation.
- Create `lib/siem/human-analysis.test.ts`: template tests for core rule categories and missing-data fallbacks.
- Modify `scripts/siem-rule-worker.ts`: set `humanAnalysis` and `recommendedAction` on findings.
- Modify `actions/siem-findings.ts`: load sample events and full finding detail.
- Create `components/admin/siem-finding-detail.tsx`: analysis, recommended action, evidence summary.
- Modify `app/(dashboard)/admin/siem/findings/page.tsx`: render selected detail when `findingId` query param exists.

---

### Task 1: Human Analysis Templates

**Files:**
- Create: `lib/siem/human-analysis.ts`
- Create: `lib/siem/human-analysis.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/siem/human-analysis.test.ts
import { describe, expect, it } from "vitest";
import { buildHumanAnalysis } from "./human-analysis";

describe("buildHumanAnalysis", () => {
  it("renders interface flap details", () => {
    const result = buildHumanAnalysis({ ruleKey: "network.interface_flap", deviceName: "core-sw", interfaceName: "Gi1/0/1", eventCount: 4, windowMinutes: 10 });
    expect(result.humanAnalysis).toContain("core-sw mengalami interface flap pada Gi1/0/1 sebanyak 4 kali dalam 10 menit");
    expect(result.recommendedAction).toContain("Cek kabel dan SFP");
  });

  it("renders failed login spike details", () => {
    const result = buildHumanAnalysis({ ruleKey: "auth.failed_login_spike", deviceName: "router01", srcIp: "10.0.0.2", username: "admin", eventCount: 5, windowMinutes: 5 });
    expect(result.humanAnalysis).toContain("5 percobaan login gagal ke router01 dari 10.0.0.2");
    expect(result.recommendedAction).toContain("Verifikasi apakah 10.0.0.2 milik admin/internal");
  });

  it("uses safe fallback instead of undefined", () => {
    const result = buildHumanAnalysis({ ruleKey: "system.config_changed", eventCount: 1, windowMinutes: 0 });
    expect(result.humanAnalysis).not.toContain("undefined");
    expect(result.recommendedAction).not.toContain("undefined");
  });
});
```

- [ ] **Step 2: Run tests RED**

Run: `rtk npm run test -- lib/siem/human-analysis.test.ts`

Expected: FAIL because file does not exist.

- [ ] **Step 3: Implement templates**

```ts
// lib/siem/human-analysis.ts
export type HumanAnalysisContext = {
  ruleKey: string;
  deviceName?: string | null;
  siteName?: string | null;
  srcIp?: string | null;
  username?: string | null;
  interfaceName?: string | null;
  eventCount: number;
  windowMinutes: number;
  eventTime?: Date | null;
};

export type HumanAnalysisResult = { humanAnalysis: string; recommendedAction: string };

function value(input: string | number | null | undefined, fallback = "unknown") {
  const text = String(input ?? "").trim();
  return text || fallback;
}

function generic(input: HumanAnalysisContext): HumanAnalysisResult {
  const device = value(input.deviceName, "perangkat/source belum dipetakan");
  return {
    humanAnalysis: `${value(input.ruleKey)} terdeteksi pada ${device} dengan ${input.eventCount} event. Dampak dan penyebab perlu diverifikasi dari evidence syslog terkait.`,
    recommendedAction: "Review sample event, validasi sumber log, cek perubahan operasional terkait, lalu eskalasi jika event berulang atau berdampak layanan.",
  };
}

const templates: Record<string, (input: HumanAnalysisContext) => HumanAnalysisResult> = {
  "network.interface_flap": (input) => ({
    humanAnalysis: `${value(input.deviceName, "Perangkat")} mengalami interface flap pada ${value(input.interfaceName, "interface unknown")} sebanyak ${input.eventCount} kali dalam ${input.windowMinutes} menit. Dampak: koneksi pada interface tersebut bisa intermittent. Kemungkinan penyebab: kabel/SFP bermasalah, peer device restart, power issue di perangkat lawan, atau speed/duplex mismatch.`,
    recommendedAction: "Cek kabel dan SFP. Cek log peer device. Cek CRC/error counter. Monitor apakah flap berulang.",
  }),
  "auth.failed_login_spike": (input) => ({
    humanAnalysis: `Terdapat ${input.eventCount} percobaan login gagal ke ${value(input.deviceName, "perangkat/source belum dipetakan")} dari ${value(input.srcIp)} dalam ${input.windowMinutes} menit. Username terkait: ${value(input.username)}. Ini bisa menandakan brute force atau kredensial yang salah digunakan berulang.`,
    recommendedAction: `Verifikasi apakah ${value(input.srcIp)} milik admin/internal. Cek username yang dicoba. Blokir sumber jika tidak dikenal. Rotasi password jika ada indikasi kompromi.`,
  }),
  "system.config_changed": (input) => ({
    humanAnalysis: `Konfigurasi perangkat ${value(input.deviceName, "perangkat/source belum dipetakan")} berubah pada ${input.eventTime?.toISOString() ?? "waktu event terkait"}. Perubahan konfigurasi bisa memengaruhi konektivitas, keamanan, atau availability.`,
    recommendedAction: "Verifikasi siapa yang melakukan perubahan. Cocokkan dengan maintenance/change request. Review konfigurasi terbaru. Rollback jika perubahan tidak sah.",
  }),
};

export function buildHumanAnalysis(input: HumanAnalysisContext): HumanAnalysisResult {
  return (templates[input.ruleKey] ?? generic)(input);
}
```

- [ ] **Step 4: Add generic coverage for all 26 rules**

Append aliases to `templates` by mapping unhandled rule keys to `generic` explicitly:

```ts
for (const key of [
  "auth.success_after_failures", "auth.login_from_unknown_ip", "auth.admin_login_outside_hours", "auth.new_username_seen",
  "network.interface_down_critical", "network.trunk_uplink_down", "network.stp_topology_burst", "network.dhcp_conflict",
  "firewall.deny_burst_source", "firewall.deny_burst_critical_destination", "firewall.port_scan_pattern", "firewall.vpn_login_failure_spike", "firewall.ips_critical_signature",
  "system.device_reboot", "system.config_changed_outside_maintenance", "system.power_supply_failure", "system.fan_temp_warning", "system.disk_full", "system.service_crash",
  "health.source_silent", "health.log_volume_spike", "health.parser_error_spike", "health.unknown_source_high_volume",
]) {
  templates[key] ??= generic;
}
```

- [ ] **Step 5: Run tests GREEN and commit**

Run:

```bash
rtk npm run test -- lib/siem/human-analysis.test.ts
rtk git add lib/siem/human-analysis.ts lib/siem/human-analysis.test.ts && rtk git commit -m "feat: add SIEM human analysis templates"
```

Expected: tests pass and commit succeeds.

---

### Task 2: Rule Worker Analysis Integration

**Files:**
- Modify: `scripts/siem-rule-worker.ts`

- [ ] **Step 1: Import and use template builder**

Add import:

```ts
import { buildHumanAnalysis } from "../lib/siem/human-analysis";
```

Before insert/update finding, compute:

```ts
const analysis = buildHumanAnalysis({
  ruleKey: rule.key,
  deviceName: match.representativeEvent.deviceName as string | null,
  siteName: match.representativeEvent.siteName as string | null,
  srcIp: match.representativeEvent.srcIp as string | null,
  username: match.representativeEvent.username as string | null,
  interfaceName: match.representativeEvent.interfaceName as string | null,
  eventCount: match.eventCount,
  windowMinutes: Math.round((rule.windowSeconds ?? 0) / 60),
  eventTime: match.lastSeenAt,
});
```

Set these fields in both insert and update:

```ts
humanAnalysis: analysis.humanAnalysis,
recommendedAction: analysis.recommendedAction,
```

- [ ] **Step 2: Typecheck**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Commit integration**

Run:

```bash
rtk git add scripts/siem-rule-worker.ts && rtk git commit -m "feat: attach human analysis to SIEM findings"
```

Expected: commit succeeds.

---

### Task 3: Finding Detail Evidence UI

**Files:**
- Modify: `actions/siem-findings.ts`
- Create: `components/admin/siem-finding-detail.tsx`
- Modify: `app/(dashboard)/admin/siem/findings/page.tsx`

- [ ] **Step 1: Add detail loader**

Append to `actions/siem-findings.ts`:

```ts
export async function getSiemFindingDetail(findingId: number) {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return null;
  const finding = await db.query.siemFindings.findFirst({ where: and(eq(siemFindings.id, findingId), eq(siemFindings.siteId, auth.activeSiteId)), with: { rule: true, device: true, source: true } });
  if (!finding) return null;
  const sampleIds = finding.sampleEventIds as number[];
  const events = sampleIds.length ? await db.query.syslogEvents.findMany({ where: (events, { inArray }) => inArray(events.id, sampleIds), with: { rawEvent: true } }) : [];
  return { ...finding, events };
}
```

- [ ] **Step 2: Create detail component**

```tsx
// components/admin/siem-finding-detail.tsx
import Link from "next/link";

type Detail = NonNullable<Awaited<ReturnType<typeof import("@/actions/siem-findings").getSiemFindingDetail>>>;

export default function SiemFindingDetail({ finding }: { finding: Detail }) {
  return (
    <section className="grid gap-4 rounded-lg border border-ops-border bg-ops-surface p-4">
      <div><h2 className="text-xl font-bold text-ops-text">{finding.title}</h2><p className="text-sm text-ops-muted">{finding.summary}</p></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div><h3 className="font-semibold text-ops-text">Analisa</h3><p className="mt-2 whitespace-pre-wrap text-sm text-ops-text">{finding.humanAnalysis || "No analysis generated."}</p></div>
        <div><h3 className="font-semibold text-ops-text">Recommended Action</h3><p className="mt-2 whitespace-pre-wrap text-sm text-ops-text">{finding.recommendedAction || "No action generated."}</p></div>
      </div>
      <div><h3 className="font-semibold text-ops-text">Evidence</h3><div className="mt-2 space-y-2">{finding.events.map((event) => <Link key={event.id} href={`/admin/siem/events?eventId=${event.id}`} className="block rounded border border-ops-border bg-ops-bg p-3 text-xs text-ops-text"><span className="font-mono">#{event.id}</span> {event.message}<pre className="mt-2 whitespace-pre-wrap text-ops-muted">{event.rawEvent.rawMessage}</pre></Link>)}</div></div>
    </section>
  );
}
```

- [ ] **Step 3: Render detail on page**

Update page signature and load selected finding:

```tsx
import { getSiemFindingDetail, getSiemFindings } from "@/actions/siem-findings";
import SiemFindingDetail from "@/components/admin/siem-finding-detail";

export default async function SiemFindingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) redirect("/checklist");
  const params = await searchParams;
  const findingId = Number(params.findingId);
  const [findings, detail] = await Promise.all([getSiemFindings(), findingId ? getSiemFindingDetail(findingId) : Promise.resolve(null)]);
  return <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-6"><PageHeader eyebrow="Admin / SIEM" title="Findings" description="Correlated SIEM findings from syslog events." /><SiemFindingTable findings={findings} />{detail && <SiemFindingDetail finding={detail} />}</main>;
}
```

- [ ] **Step 4: Typecheck and commit**

Run:

```bash
rtk npx tsc --noEmit
rtk git add actions/siem-findings.ts components/admin/siem-finding-detail.tsx "app/(dashboard)/admin/siem/findings/page.tsx" && rtk git commit -m "feat: show SIEM finding analysis"
```

Expected: PASS and commit succeeds.

---

### Task 4: Phase 07 Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run template tests**

Run: `rtk npm run test -- lib/siem/human-analysis.test.ts`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Manual finding detail check**

Run: `rtk npm run dev`

Open `/admin/siem/findings?findingId=<id>`.

Expected: analysis, recommended action, and sample raw event evidence render as escaped text.
