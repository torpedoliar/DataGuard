# SIEM AI Keyless Router Config — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SIEM AI provider key optional (router holds credentials) and replace the four model fields with a single free-form model field.

**Architecture:** OpenAI-compatible `/chat/completions` call where the `Authorization` header is sent only when an API key is configured. Model selection collapses from `aiDefaultModel/Opus/Sonnet/Haiku` to a single `aiDefaultModel` column; the three tier columns are dropped via a Drizzle migration. Changes flow bottom-up: request lib → DB schema/migration → server actions → settings UI.

**Tech Stack:** Next.js (App Router, server actions), Drizzle ORM (PostgreSQL), Zod, Vitest.

---

## File Structure

- `lib/siem/ai-analysis.ts` — request builder + types. Conditional auth header; remove `resolveSiemAiModel`; trim model tier fields from `SiemAiSettingsInput`.
- `lib/siem/ai-analysis.test.ts` — unit tests. Drop `resolveSiemAiModel` test; add conditional-header tests.
- `db/schema.ts` — drop `ai_model_opus/sonnet/haiku` columns from `siemSettings`.
- `drizzle/0006_*.sql` (+ meta) — generated migration dropping the three columns.
- `actions/siem-settings.ts` — Zod schema, `getSiemAiSettings`, `updateSiemAiSettings`.
- `actions/siem-ai.ts` — relax guard (key optional), single-model resolution, env overrides.
- `components/admin/siem-ai-settings-form.tsx` — one model input, optional key label, readiness badge.

---

## Task 1: Conditional auth header + single-model resolution in request lib

**Files:**
- Modify: `lib/siem/ai-analysis.ts`
- Test: `lib/siem/ai-analysis.test.ts`

- [ ] **Step 1: Update the test file — remove the `resolveSiemAiModel` test and add header tests**

In `lib/siem/ai-analysis.test.ts`, change the import line (line 2) from:

```ts
import { buildSiemAiPrompt, normalizeOpenAiCompatibleEndpoint, normalizeSiemAiAnalysis, resolveSiemAiModel } from "./ai-analysis";
```

to:

```ts
import { buildSiemAiPrompt, normalizeOpenAiCompatibleEndpoint, normalizeSiemAiAnalysis, requestSiemAiAnalysis } from "./ai-analysis";
```

Delete the entire `it("resolves default model with fallback order", ...)` block (lines 11-15).

Add these two tests inside the `describe` block (e.g. after the endpoint test):

```ts
it("omits the Authorization header when no api key is provided", async () => {
  let capturedHeaders: Record<string, string> = {};
  const fetchFn = (async (_url: string, init: RequestInit) => {
    capturedHeaders = init.headers as Record<string, string>;
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  await requestSiemAiAnalysis({ endpointUrl: "https://router.local/v1/chat/completions", model: "m", prompt: "p", fetchFn });

  expect(capturedHeaders.Authorization).toBeUndefined();
  expect(capturedHeaders["Content-Type"]).toBe("application/json");
});

it("sends a Bearer Authorization header when an api key is provided", async () => {
  let capturedHeaders: Record<string, string> = {};
  const fetchFn = (async (_url: string, init: RequestInit) => {
    capturedHeaders = init.headers as Record<string, string>;
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  await requestSiemAiAnalysis({ endpointUrl: "https://router.local/v1/chat/completions", apiKey: "sk-123", model: "m", prompt: "p", fetchFn });

  expect(capturedHeaders.Authorization).toBe("Bearer sk-123");
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run lib/siem/ai-analysis.test.ts`
Expected: FAIL — `requestSiemAiAnalysis` currently always sets `Authorization`, so the "omits" test fails; the `resolveSiemAiModel` import is gone so any leftover reference errors. (Type errors are acceptable as a failure signal here.)

- [ ] **Step 3: Make `apiKey` optional and build headers conditionally**

In `lib/siem/ai-analysis.ts`, replace the `requestSiemAiAnalysis` function (lines 122-146) with:

```ts
export async function requestSiemAiAnalysis(input: { endpointUrl: string; apiKey?: string | null; model: string; prompt: string; fetchFn?: typeof fetch }) {
  const fetchImpl = input.fetchFn ?? fetch;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = input.apiKey?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetchImpl(input.endpointUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: "You produce evidence-only defensive SIEM analysis as strict JSON." },
        { role: "user", content: input.prompt },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) throw new Error("AI provider rejected request.");
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI provider returned empty response.");
  return JSON.parse(content) as unknown;
}
```

- [ ] **Step 4: Remove `resolveSiemAiModel` and trim the settings type**

In `lib/siem/ai-analysis.ts`, delete the `resolveSiemAiModel` function (lines 61-63):

```ts
export function resolveSiemAiModel(settings: Pick<SiemAiSettingsInput, "aiDefaultModel" | "aiModelOpus" | "aiModelSonnet" | "aiModelHaiku">) {
  return settings.aiDefaultModel?.trim() || settings.aiModelSonnet?.trim() || settings.aiModelOpus?.trim() || settings.aiModelHaiku?.trim() || null;
}
```

Then remove the three tier fields from the `SiemAiSettingsInput` type (lines 7-9), so it becomes:

```ts
export type SiemAiSettingsInput = {
  aiEnabled: boolean;
  aiEndpointUrl: string | null;
  aiApiKey: string | null;
  aiDefaultModel: string | null;
  aiMaxSampleEvents: number;
  aiMaxRawLength: number;
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/siem/ai-analysis.test.ts`
Expected: PASS — all 4 remaining tests (endpoint, two header tests, prompt, normalize) green.

- [ ] **Step 6: Commit**

```bash
git add lib/siem/ai-analysis.ts lib/siem/ai-analysis.test.ts
git commit -m "feat(siem-ai): make auth header conditional and collapse to single model"
```

---

## Task 2: Drop the three model tier columns from the schema

**Files:**
- Modify: `db/schema.ts:603-605`
- Create: `drizzle/0006_*.sql` (+ `drizzle/meta` update) via generate

- [ ] **Step 1: Remove the columns from the schema**

In `db/schema.ts`, delete these three lines (603-605) from the `siemSettings` table:

```ts
  aiModelOpus: text("ai_model_opus"),
  aiModelSonnet: text("ai_model_sonnet"),
  aiModelHaiku: text("ai_model_haiku"),
```

Leave `aiEndpointUrl`, `aiApiKey`, and `aiDefaultModel` intact.

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: A new file `drizzle/0006_<random>.sql` is created containing `ALTER TABLE "siem_settings" DROP COLUMN ...` for the three columns, plus an updated `drizzle/meta/_journal.json` and `0006_snapshot.json`.

- [ ] **Step 3: Verify the generated SQL**

Open the new `drizzle/0006_*.sql` and confirm it contains exactly three `DROP COLUMN` statements for `ai_model_opus`, `ai_model_sonnet`, `ai_model_haiku` and no unexpected changes (no DROP on `ai_default_model` / `ai_api_key`).

- [ ] **Step 4: Apply the migration to the dev database**

Run: `npm run db:migrate`
Expected: Migration applies without error. (If the dev DB is unavailable, skip applying but keep the generated file committed; note it must be applied before deploy.)

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts drizzle/
git commit -m "feat(siem-ai): drop redundant model tier columns"
```

---

## Task 3: Update the settings server action

**Files:**
- Modify: `actions/siem-settings.ts:12-22` (Zod), `:32-48` (`getSiemAiSettings`), `:50-88` (`updateSiemAiSettings`)

- [ ] **Step 1: Trim the Zod schema**

In `actions/siem-settings.ts`, replace `aiSettingsSchema` (lines 12-22) with:

```ts
const aiSettingsSchema = z.object({
  aiEnabled: z.coerce.boolean(),
  aiEndpointUrl: z.string().url("Endpoint AI harus berupa URL valid.").max(500),
  aiApiKey: z.string().max(500).optional(),
  aiDefaultModel: z.string().min(1, "Model wajib diisi.").max(120),
  aiMaxSampleEvents: z.coerce.number().int().min(1).max(20),
  aiMaxRawLength: z.coerce.number().int().min(200).max(10000),
});
```

- [ ] **Step 2: Update `getSiemAiSettings` return shape**

Replace the return object in `getSiemAiSettings` (lines 37-47) with:

```ts
  return {
    aiEnabled: settings?.aiEnabled ?? false,
    aiEndpointUrl: settings?.aiEndpointUrl ?? "",
    aiApiKeyConfigured: Boolean(settings?.aiApiKey?.trim() || process.env.SIEM_AI_API_KEY?.trim()),
    aiDefaultModel: settings?.aiDefaultModel ?? "",
    aiReady: Boolean((process.env.SIEM_AI_ENDPOINT_URL || settings?.aiEndpointUrl) && (process.env.SIEM_AI_DEFAULT_MODEL || settings?.aiDefaultModel)),
    aiMaxSampleEvents: settings?.aiMaxSampleEvents ?? 5,
    aiMaxRawLength: settings?.aiMaxRawLength ?? 2000,
  };
```

- [ ] **Step 3: Update the parse call and persisted values in `updateSiemAiSettings`**

In `updateSiemAiSettings`, replace the `safeParse` argument (lines 55-65) with:

```ts
  const parsed = aiSettingsSchema.safeParse({
    aiEnabled: formData.get("aiEnabled") === "true",
    aiEndpointUrl: formData.get("aiEndpointUrl"),
    aiApiKey: String(formData.get("aiApiKey") ?? ""),
    aiDefaultModel: formData.get("aiDefaultModel"),
    aiMaxSampleEvents: formData.get("aiMaxSampleEvents"),
    aiMaxRawLength: formData.get("aiMaxRawLength"),
  });
```

Then replace the `values` object (lines 69-79) with:

```ts
  const values: Partial<typeof siemSettings.$inferInsert> = {
    aiEnabled: parsed.data.aiEnabled,
    aiEndpointUrl: parsed.data.aiEndpointUrl.trim(),
    aiDefaultModel: parsed.data.aiDefaultModel.trim(),
    aiMaxSampleEvents: parsed.data.aiMaxSampleEvents,
    aiMaxRawLength: parsed.data.aiMaxRawLength,
    updatedAt: new Date(),
  };
```

(Leave the `if (parsed.data.aiApiKey?.trim()) values.aiApiKey = ...` line and the insert/update logic below unchanged.)

- [ ] **Step 4: Type-check the action**

Run: `npx tsc --noEmit`
Expected: No errors referencing `aiModelOpus/Sonnet/Haiku` in `actions/siem-settings.ts`. (Errors may still appear from Task 4/5 files not yet updated — that is expected at this point; confirm none originate from `siem-settings.ts`.)

- [ ] **Step 5: Commit**

```bash
git add actions/siem-settings.ts
git commit -m "feat(siem-ai): make key optional and single model in settings action"
```

---

## Task 4: Relax the analysis action guard and model resolution

**Files:**
- Modify: `actions/siem-ai.ts:7` (import), `:22-30` (resolution + guard), `:78` (request call)

- [ ] **Step 1: Update the import (remove `resolveSiemAiModel`)**

In `actions/siem-ai.ts`, change the import on line 7 from:

```ts
import { buildSiemAiPrompt, normalizeOpenAiCompatibleEndpoint, normalizeSiemAiAnalysis, requestSiemAiAnalysis, resolveSiemAiModel, type SiemAiEventSample } from "@/lib/siem/ai-analysis";
```

to:

```ts
import { buildSiemAiPrompt, normalizeOpenAiCompatibleEndpoint, normalizeSiemAiAnalysis, requestSiemAiAnalysis, type SiemAiEventSample } from "@/lib/siem/ai-analysis";
```

- [ ] **Step 2: Replace resolution + guard so key is optional and model is single**

Replace lines 22-30 (the endpoint/apiKey/model resolution and the guard) with:

```ts
  const endpointUrl = normalizeOpenAiCompatibleEndpoint(process.env.SIEM_AI_ENDPOINT_URL || settings.aiEndpointUrl || "");
  const apiKey = process.env.SIEM_AI_API_KEY || settings.aiApiKey || "";
  const model = (process.env.SIEM_AI_DEFAULT_MODEL || settings.aiDefaultModel || "").trim();
  if (!endpointUrl || !model) return { message: "SIEM AI endpoint dan model harus dikonfigurasi." };
```

- [ ] **Step 3: Pass the (optional) key through**

The existing call on line 78 already passes `apiKey`:

```ts
    const providerJson = await requestSiemAiAnalysis({ endpointUrl, apiKey, model, prompt });
```

No change needed — `requestSiemAiAnalysis` now treats an empty `apiKey` as "no header". Confirm this line is unchanged.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors in `actions/siem-ai.ts`.

- [ ] **Step 5: Commit**

```bash
git add actions/siem-ai.ts
git commit -m "feat(siem-ai): allow analysis without api key, single model resolution"
```

---

## Task 5: Update the settings form UI

**Files:**
- Modify: `components/admin/siem-ai-settings-form.tsx`

- [ ] **Step 1: Update the `SiemAiSettingsData` type**

In `components/admin/siem-ai-settings-form.tsx`, replace the type (lines 8-18) with:

```ts
type SiemAiSettingsData = {
  aiEnabled: boolean;
  aiEndpointUrl: string;
  aiApiKeyConfigured: boolean;
  aiDefaultModel: string;
  aiReady: boolean;
  aiMaxSampleEvents: number;
  aiMaxRawLength: number;
};
```

- [ ] **Step 2: Replace the readiness badge**

Replace the badge `<span>` (lines 36-38) with:

```tsx
        <span className={`inline-flex h-7 w-fit items-center rounded-full border px-3 text-xs font-medium ${initialData.aiReady ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border-amber-400/25 bg-amber-400/10 text-amber-300"}`}>
          {initialData.aiReady ? "Siap" : "Belum lengkap"}
        </span>
```

- [ ] **Step 3: Mark the API key field optional**

Replace the API Key label block (lines 53-56) with:

```tsx
        <label className="space-y-1.5 text-sm font-medium text-slate-300">
          API Key <span className="text-xs font-normal text-slate-500">(opsional)</span>
          <input name="aiApiKey" type="password" autoComplete="off" placeholder={initialData.aiApiKeyConfigured ? "Token tersimpan; isi hanya untuk mengganti" : "Kosongkan jika router sudah memegang kredensial"} className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white" />
        </label>
```

- [ ] **Step 4: Collapse to a single Model field and remove the three tier inputs**

Replace the Default Model label and the three tier labels (lines 57-72) with a single block:

```tsx
        <label className="space-y-1.5 text-sm font-medium text-slate-300">
          Model
          <input name="aiDefaultModel" defaultValue={initialData.aiDefaultModel} required placeholder="anthropic/claude-sonnet-4.6" className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white" />
        </label>
```

(Delete the `aiModelOpus`, `aiModelSonnet`, `aiModelHaiku` labels entirely. Keep the Sample Events / Max Raw Length grid below unchanged.)

- [ ] **Step 5: Update the helper copy (optional but recommended)**

In the description paragraph (line 34), the existing text already says "Environment variables override saved values." Update it to reflect the optional key:

```tsx
          <p className="mt-1 text-xs text-slate-400">Konfigurasi OpenAI-compatible untuk 9router/provider /chat/completions. API key opsional bila router memegang kredensial. Environment variables menimpa nilai tersimpan.</p>
```

- [ ] **Step 6: Type-check + lint**

Run: `npx tsc --noEmit; npm run lint`
Expected: No errors. No references to `aiModelOpus/Sonnet/Haiku` remain anywhere.

- [ ] **Step 7: Commit**

```bash
git add components/admin/siem-ai-settings-form.tsx
git commit -m "feat(siem-ai): single model field and optional key in settings form"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full check pipeline**

Run: `npm run check`
Expected: lint passes, all Vitest tests pass (including the two new header tests), and `next build` succeeds.

- [ ] **Step 2: Manual smoke test**

Start the app (`npm run dev`), open `/admin/settings`, in the SIEM AI form:
- Leave API Key empty, set Endpoint to your local router URL and Model to a free-form model id, set Enabled = Enabled, Save.
- Confirm the badge shows "Siap" and the save succeeds.
- Trigger "Generate AI analysis" on a finding and confirm it reaches the router without an Authorization header (verify in router logs).

- [ ] **Step 3: Final commit (if any stray changes)**

```bash
git add -A
git commit -m "chore(siem-ai): finalize keyless router config"
```
