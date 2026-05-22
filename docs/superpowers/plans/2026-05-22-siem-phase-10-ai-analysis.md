# SIEM Phase 10 AI-Assisted Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional on-demand AI analysis for SIEM findings using manual OpenAI-compatible 9router configuration with evidence-only prompts and redaction.

**Architecture:** Keep AI config resolution in `lib/siem/ai-config.ts`, prompt construction in `lib/siem/ai-prompt.ts`, OpenAI-compatible HTTP adapter in `lib/siem/ai-client.ts`, and UI/server action integration in findings/settings. Environment variables override DB settings.

**Tech Stack:** TypeScript, Next.js server actions, Drizzle ORM, fetch/OpenAI-compatible `/chat/completions`, Zod or manual JSON validation, Vitest.

---

## File Structure

- Create `lib/siem/ai-config.ts`: env-over-DB config resolution types and helpers.
- Create `lib/siem/ai-config.test.ts`: env override tests.
- Create `lib/siem/ai-prompt.ts`: redacted evidence-only prompt builder.
- Create `lib/siem/ai-prompt.test.ts`: evidence boundary and redaction tests.
- Create `lib/siem/ai-client.ts`: OpenAI-compatible `/chat/completions` adapter and JSON response parser.
- Create `lib/siem/ai-client.test.ts`: request/response parsing tests with mocked fetch.
- Modify `actions/siem-findings.ts`: `generateSiemAiAnalysis` action.
- Modify `actions/settings.ts` or create `actions/siem-settings.ts`: load/update SIEM AI settings.
- Create `components/admin/siem-settings-form.tsx`: endpoint/API key/models/default model settings.
- Create `app/(dashboard)/admin/siem/settings/page.tsx`: admin-only settings page.
- Modify `components/admin/siem-finding-detail.tsx`: Generate/Regenerate AI Analysis button and display.

---

### Task 1: AI Config Resolution

**Files:**
- Create: `lib/siem/ai-config.ts`
- Create: `lib/siem/ai-config.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/siem/ai-config.test.ts
import { describe, expect, it } from "vitest";
import { resolveSiemAiConfig } from "./ai-config";

describe("resolveSiemAiConfig", () => {
  it("uses env values before database values", () => {
    expect(resolveSiemAiConfig({ SIEM_AI_ENDPOINT_URL: "http://127.0.0.1:20128/v1", SIEM_AI_API_KEY: "env-key", SIEM_AI_DEFAULT_MODEL: "cx/gpt-5.5-xhigh" }, { aiEnabled: true, aiEndpointUrl: "db-url", aiApiKey: "db-key", aiDefaultModel: "db-model", aiMaxSampleEvents: 5, aiMaxRawLength: 2000 })).toMatchObject({ enabled: true, endpointUrl: "http://127.0.0.1:20128/v1", apiKey: "env-key", defaultModel: "cx/gpt-5.5-xhigh" });
  });

  it("returns disabled config when disabled in DB and env does not force enable", () => {
    expect(resolveSiemAiConfig({}, { aiEnabled: false, aiEndpointUrl: "db-url", aiApiKey: "db-key", aiDefaultModel: "db-model", aiMaxSampleEvents: 5, aiMaxRawLength: 2000 }).enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests RED**

Run: `rtk npm run test -- lib/siem/ai-config.test.ts`

Expected: FAIL because file does not exist.

- [ ] **Step 3: Implement config resolver**

```ts
// lib/siem/ai-config.ts
export type SiemAiDbSettings = {
  aiEnabled: boolean;
  aiEndpointUrl: string | null;
  aiApiKey: string | null;
  aiModelOpus?: string | null;
  aiModelSonnet?: string | null;
  aiModelHaiku?: string | null;
  aiDefaultModel: string | null;
  aiMaxSampleEvents: number;
  aiMaxRawLength: number;
};

export type SiemAiConfig = {
  enabled: boolean;
  endpointUrl: string | null;
  apiKey: string | null;
  defaultModel: string | null;
  maxSampleEvents: number;
  maxRawLength: number;
};

function envValue(env: Record<string, string | undefined>, key: string) {
  return env[key]?.trim() || null;
}

export function resolveSiemAiConfig(env: Record<string, string | undefined>, db: SiemAiDbSettings | null): SiemAiConfig {
  const enabledFromEnv = envValue(env, "SIEM_AI_ENABLED");
  return {
    enabled: enabledFromEnv ? enabledFromEnv === "true" : Boolean(db?.aiEnabled),
    endpointUrl: envValue(env, "SIEM_AI_ENDPOINT_URL") ?? db?.aiEndpointUrl ?? null,
    apiKey: envValue(env, "SIEM_AI_API_KEY") ?? db?.aiApiKey ?? null,
    defaultModel: envValue(env, "SIEM_AI_DEFAULT_MODEL") ?? db?.aiDefaultModel ?? db?.aiModelSonnet ?? db?.aiModelOpus ?? db?.aiModelHaiku ?? null,
    maxSampleEvents: Number(env.SIEM_AI_MAX_SAMPLE_EVENTS ?? db?.aiMaxSampleEvents ?? 5),
    maxRawLength: Number(env.SIEM_AI_MAX_RAW_LENGTH ?? db?.aiMaxRawLength ?? 2000),
  };
}
```

- [ ] **Step 4: Run tests GREEN and commit**

Run:

```bash
rtk npm run test -- lib/siem/ai-config.test.ts
rtk git add lib/siem/ai-config.ts lib/siem/ai-config.test.ts && rtk git commit -m "feat: resolve SIEM AI config"
```

Expected: PASS and commit succeeds.

---

### Task 2: Evidence-Only Prompt Builder

**Files:**
- Create: `lib/siem/ai-prompt.ts`
- Create: `lib/siem/ai-prompt.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/siem/ai-prompt.test.ts
import { describe, expect, it } from "vitest";
import { buildSiemAiPrompt } from "./ai-prompt";

describe("buildSiemAiPrompt", () => {
  it("includes finding and linked sample events only", () => {
    const prompt = buildSiemAiPrompt({ finding: { title: "Failed login", summary: "5 failures", severity: "High", humanAnalysis: "Rule analysis" }, events: [{ id: 1, normalizedType: "auth_failed", rawMessage: "failed password for admin password=secret" }], maxRawLength: 2000 });
    expect(prompt).toContain("Failed login");
    expect(prompt).toContain("event_id: 1");
    expect(prompt).not.toContain("secret");
    expect(prompt).toContain("[REDACTED]");
  });

  it("truncates raw messages", () => {
    const prompt = buildSiemAiPrompt({ finding: { title: "T", summary: "S", severity: "Low", humanAnalysis: null }, events: [{ id: 1, normalizedType: "x", rawMessage: "abcdef" }], maxRawLength: 3 });
    expect(prompt).toContain("abc...[truncated]");
  });
});
```

- [ ] **Step 2: Run tests RED**

Run: `rtk npm run test -- lib/siem/ai-prompt.test.ts`

Expected: FAIL because prompt builder does not exist.

- [ ] **Step 3: Implement prompt builder**

```ts
// lib/siem/ai-prompt.ts
import { redactSecrets } from "./security";

export function buildSiemAiPrompt(input: { finding: { title: string; summary: string; severity: string; humanAnalysis: string | null }; events: Array<{ id: number; normalizedType: string | null; rawMessage: string }>; maxRawLength: number }) {
  const eventLines = input.events.map((event) => {
    const redacted = redactSecrets(event.rawMessage);
    const raw = redacted.length > input.maxRawLength ? `${redacted.slice(0, input.maxRawLength)}...[truncated]` : redacted;
    return [`event_id: ${event.id}`, `normalized_type: ${event.normalizedType ?? "unknown"}`, `raw: ${raw}`].join("\n");
  }).join("\n---\n");

  return [
    "You analyze SIEM findings using only provided evidence.",
    "If evidence is insufficient, say so. Do not invent device state or external facts. Do not recommend destructive action as first step.",
    "Return valid JSON only with keys: summary, impact, likelyCauses, recommendedActions, confidence, evidenceLimits.",
    "",
    `Finding title: ${input.finding.title}`,
    `Severity: ${input.finding.severity}`,
    `Rule summary: ${input.finding.summary}`,
    `Rule analysis: ${input.finding.humanAnalysis ?? "none"}`,
    "",
    "Evidence events:",
    eventLines,
  ].join("\n");
}
```

- [ ] **Step 4: Run tests GREEN and commit**

Run:

```bash
rtk npm run test -- lib/siem/ai-prompt.test.ts
rtk git add lib/siem/ai-prompt.ts lib/siem/ai-prompt.test.ts && rtk git commit -m "feat: build SIEM AI prompts"
```

Expected: PASS and commit succeeds.

---

### Task 3: OpenAI-Compatible Client

**Files:**
- Create: `lib/siem/ai-client.ts`
- Create: `lib/siem/ai-client.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/siem/ai-client.test.ts
import { describe, expect, it, vi } from "vitest";
import { requestSiemAiAnalysis } from "./ai-client";

describe("requestSiemAiAnalysis", () => {
  it("posts to chat completions and parses JSON content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: "s", impact: "i", likelyCauses: ["c"], recommendedActions: ["a"], confidence: "medium", evidenceLimits: "l" }) } }] }) });
    const result = await requestSiemAiAnalysis({ endpointUrl: "http://127.0.0.1:20128/v1", apiKey: "sk-test", model: "cx/gpt-5.5-xhigh", prompt: "hello", fetchImpl: fetchMock as typeof fetch });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:20128/v1/chat/completions", expect.objectContaining({ method: "POST" }));
    expect(result.summary).toBe("s");
  });
});
```

- [ ] **Step 2: Run tests RED**

Run: `rtk npm run test -- lib/siem/ai-client.test.ts`

Expected: FAIL because client does not exist.

- [ ] **Step 3: Implement client**

```ts
// lib/siem/ai-client.ts
export type SiemAiAnalysis = { summary: string; impact: string; likelyCauses: string[]; recommendedActions: string[]; confidence: "low" | "medium" | "high"; evidenceLimits: string };

function parseAnalysis(value: unknown): SiemAiAnalysis {
  const candidate = value as Partial<SiemAiAnalysis>;
  if (!candidate.summary || !candidate.impact || !Array.isArray(candidate.likelyCauses) || !Array.isArray(candidate.recommendedActions) || !["low", "medium", "high"].includes(String(candidate.confidence)) || !candidate.evidenceLimits) {
    throw new Error("Invalid SIEM AI analysis response");
  }
  return candidate as SiemAiAnalysis;
}

export async function requestSiemAiAnalysis(input: { endpointUrl: string; apiKey: string; model: string; prompt: string; fetchImpl?: typeof fetch }) {
  const fetcher = input.fetchImpl ?? fetch;
  const base = input.endpointUrl.replace(/\/+$/, "");
  const response = await fetcher(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify({ model: input.model, messages: [{ role: "user", content: input.prompt }], temperature: 0.2 }),
  });
  if (!response.ok) throw new Error("AI endpoint rejected request");
  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("AI response missing message content");
  return parseAnalysis(JSON.parse(content));
}
```

- [ ] **Step 4: Run tests GREEN and commit**

Run:

```bash
rtk npm run test -- lib/siem/ai-client.test.ts
rtk git add lib/siem/ai-client.ts lib/siem/ai-client.test.ts && rtk git commit -m "feat: add SIEM AI client"
```

Expected: PASS and commit succeeds.

---

### Task 4: Settings UI and Actions

**Files:**
- Create: `actions/siem-settings.ts`
- Create: `components/admin/siem-settings-form.tsx`
- Create: `app/(dashboard)/admin/siem/settings/page.tsx`

- [ ] **Step 1: Create settings actions**

```ts
// actions/siem-settings.ts
"use server";

import { db } from "@/db";
import { siemSettings, sites } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function getSiemSettings() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return null;
  const [settings, siteRows] = await Promise.all([db.query.siemSettings.findFirst(), db.select({ id: sites.id, name: sites.name }).from(sites)]);
  return { settings, sites: siteRows };
}

export async function updateSiemSettings(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };
  const values = {
    defaultSiemSiteId: Number(formData.get("defaultSiemSiteId")) || null,
    aiEnabled: formData.get("aiEnabled") === "on",
    aiEndpointUrl: String(formData.get("aiEndpointUrl") ?? "").trim() || null,
    aiApiKey: String(formData.get("aiApiKey") ?? "").trim() || null,
    aiModelOpus: String(formData.get("aiModelOpus") ?? "").trim() || null,
    aiModelSonnet: String(formData.get("aiModelSonnet") ?? "").trim() || null,
    aiModelHaiku: String(formData.get("aiModelHaiku") ?? "").trim() || null,
    aiDefaultModel: String(formData.get("aiDefaultModel") ?? "").trim() || null,
    updatedAt: new Date(),
  };
  const existing = await db.query.siemSettings.findFirst();
  if (existing) await db.update(siemSettings).set(values).where(eq(siemSettings.id, existing.id));
  else await db.insert(siemSettings).values(values);
  revalidatePath("/admin/siem/settings");
  return { success: true };
}
```

- [ ] **Step 2: Create settings form and page**

```tsx
// components/admin/siem-settings-form.tsx
"use client";

import { updateSiemSettings } from "@/actions/siem-settings";
import { useActionState } from "react";

type Data = NonNullable<Awaited<ReturnType<typeof import("@/actions/siem-settings").getSiemSettings>>>;

export default function SiemSettingsForm({ data }: { data: Data }) {
  const [, action] = useActionState(updateSiemSettings, null);
  const settings = data.settings;
  return <form action={action} className="grid gap-4 rounded-lg border border-ops-border bg-ops-surface p-4"><label className="grid gap-1 text-sm text-ops-text">Default SIEM Site<select name="defaultSiemSiteId" defaultValue={settings?.defaultSiemSiteId ?? ""} className="rounded border border-ops-border bg-ops-bg px-3 py-2"><option value="">Select site</option>{data.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><label className="flex items-center gap-2 text-sm text-ops-text"><input type="checkbox" name="aiEnabled" defaultChecked={settings?.aiEnabled ?? false} /> Enable AI analysis</label><input name="aiEndpointUrl" defaultValue={settings?.aiEndpointUrl ?? ""} placeholder="http://127.0.0.1:20128/v1" className="rounded border border-ops-border bg-ops-bg px-3 py-2 text-ops-text" /><input name="aiApiKey" type="password" placeholder="sk-..." className="rounded border border-ops-border bg-ops-bg px-3 py-2 text-ops-text" /><input name="aiModelOpus" defaultValue={settings?.aiModelOpus ?? ""} placeholder="kr/claude-opus-4.7" className="rounded border border-ops-border bg-ops-bg px-3 py-2 text-ops-text" /><input name="aiModelSonnet" defaultValue={settings?.aiModelSonnet ?? ""} placeholder="cx/gpt-5.5-xhigh" className="rounded border border-ops-border bg-ops-bg px-3 py-2 text-ops-text" /><input name="aiModelHaiku" defaultValue={settings?.aiModelHaiku ?? ""} placeholder="cx/gpt-5.5-xhigh" className="rounded border border-ops-border bg-ops-bg px-3 py-2 text-ops-text" /><input name="aiDefaultModel" defaultValue={settings?.aiDefaultModel ?? ""} placeholder="Default model ID" className="rounded border border-ops-border bg-ops-bg px-3 py-2 text-ops-text" /><button className="rounded bg-ops-accent px-3 py-2 text-sm font-bold text-slate-950">Save SIEM Settings</button></form>;
}
```

```tsx
// app/(dashboard)/admin/siem/settings/page.tsx
import { getSiemSettings } from "@/actions/siem-settings";
import SiemSettingsForm from "@/components/admin/siem-settings-form";
import PageHeader from "@/components/ui/page-header";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { redirect } from "next/navigation";

export default async function SiemSettingsPage() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) redirect("/checklist");
  const data = await getSiemSettings();
  if (!data) redirect("/checklist");
  return <main className="mx-auto flex w-full max-w-[900px] flex-col gap-5 px-4 py-5 lg:px-6"><PageHeader eyebrow="Admin / SIEM" title="SIEM Settings" description="Receiver defaults, unknown source site, and 9router-compatible AI config." /><SiemSettingsForm data={data} /></main>;
}
```

- [ ] **Step 3: Typecheck and commit**

Run:

```bash
rtk npx tsc --noEmit
rtk git add actions/siem-settings.ts components/admin/siem-settings-form.tsx "app/(dashboard)/admin/siem/settings/page.tsx" && rtk git commit -m "feat: add SIEM AI settings"
```

Expected: PASS and commit succeeds.

---

### Task 5: Generate AI Analysis Action and UI

**Files:**
- Modify: `actions/siem-findings.ts`
- Modify: `components/admin/siem-finding-detail.tsx`

- [ ] **Step 1: Add action**

Append to `actions/siem-findings.ts`:

```ts
import { resolveSiemAiConfig } from "@/lib/siem/ai-config";
import { buildSiemAiPrompt } from "@/lib/siem/ai-prompt";
import { requestSiemAiAnalysis } from "@/lib/siem/ai-client";
import { siemSettings } from "@/db/schema";

export async function generateSiemAiAnalysis(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };
  const findingId = Number(formData.get("findingId"));
  if (!findingId) return { message: "Invalid finding." };
  const detail = await getSiemFindingDetail(findingId);
  if (!detail) return { message: "Finding not found." };
  const settings = await db.query.siemSettings.findFirst();
  const config = resolveSiemAiConfig(process.env, settings);
  if (!config.enabled || !config.endpointUrl || !config.apiKey || !config.defaultModel) return { message: "SIEM AI is not configured." };
  const prompt = buildSiemAiPrompt({ finding: { title: detail.title, summary: detail.summary, severity: detail.severity, humanAnalysis: detail.humanAnalysis }, events: detail.events.slice(0, config.maxSampleEvents).map((event) => ({ id: event.id, normalizedType: event.normalizedType, rawMessage: event.rawEvent.rawMessage })), maxRawLength: config.maxRawLength });
  const analysis = await requestSiemAiAnalysis({ endpointUrl: config.endpointUrl, apiKey: config.apiKey, model: config.defaultModel, prompt });
  await db.update(siemFindings).set({ aiAnalysis: analysis, aiGeneratedAt: new Date(), updatedAt: new Date() }).where(and(eq(siemFindings.id, findingId), eq(siemFindings.siteId, auth.activeSiteId)));
  revalidatePath("/admin/siem/findings");
  return { success: true };
}
```

- [ ] **Step 2: Add UI button and display**

In `components/admin/siem-finding-detail.tsx`, import action:

```ts
import { generateSiemAiAnalysis } from "@/actions/siem-findings";
```

Add form near action buttons:

```tsx
<form action={generateSiemAiAnalysis}>
  <input type="hidden" name="findingId" value={finding.id} />
  <button className="rounded border border-ops-border px-3 py-2 text-sm font-bold text-ops-text">Generate AI Analysis</button>
</form>
```

Add display block:

```tsx
{finding.aiAnalysis && (
  <div className="rounded border border-ops-border bg-ops-bg p-3">
    <h3 className="font-semibold text-ops-text">AI Analysis</h3>
    <pre className="mt-2 whitespace-pre-wrap text-xs text-ops-text">{JSON.stringify(finding.aiAnalysis, null, 2)}</pre>
  </div>
)}
```

- [ ] **Step 3: Typecheck and commit**

Run:

```bash
rtk npx tsc --noEmit
rtk git add actions/siem-findings.ts components/admin/siem-finding-detail.tsx && rtk git commit -m "feat: generate SIEM AI analysis"
```

Expected: PASS and commit succeeds.

---

### Task 6: Phase 10 Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run AI tests**

Run:

```bash
rtk npm run test -- lib/siem/ai-config.test.ts lib/siem/ai-prompt.test.ts lib/siem/ai-client.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Manual 9router check**

Open `/admin/siem/settings` and set:

- endpoint: `http://127.0.0.1:20128/v1`
- API key: `sk-...`
- default model: `cx/gpt-5.5-xhigh`

Open `/admin/siem/findings?findingId=<id>` and click Generate AI Analysis.

Expected: AI result saves to finding, evidence is limited to sample events, and raw secrets are redacted before request.
