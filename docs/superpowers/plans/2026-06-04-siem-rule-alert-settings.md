# SIEM Rule Alert Settings + Navbar Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/admin/siem/rules` page where admins toggle, per rule, whether it runs (`enabled`) and whether it alerts to Telegram (`alertEnabled`), plus a global minimum alert severity; add a "SIEM" link to the navbar; and stop the rule re-seed from overwriting user toggles.

**Architecture:** Next.js App Router (server components + server actions). A new server component page fetches rules via a new server action and renders a client form (`useActionState`). The form posts all toggles at once to `updateSiemRules`, which writes `siem_rules.enabled/alert_enabled` and `siem_settings.alert_min_severity`. The seed function (`seedDefaultSiemRules`, run by the rule worker on startup) is changed to preserve `enabled`/`alertEnabled` for existing rules. Pure helpers are extracted for the seed-conflict column set and the form parse/clamp so they can be unit-tested without a database.

**Tech Stack:** TypeScript, Next.js (App Router, server actions), Drizzle ORM (node-postgres), Zod, Vitest, Tailwind, lucide-react.

---

## Context the executor needs

- **Repo root:** `E:\Vibe\dc-check` (Windows). Use the test runner via `npx vitest run <path>` and typecheck via `npx tsc --noEmit`.
- **DB access in actions:** `import { db } from "@/db"`. Drizzle node-postgres supports `await db.transaction(async (tx) => { ... })`.
- **Schema:** `db/schema.ts`. Relevant tables:
  - `siemRules` columns: `id`, `key` (unique), `name`, `description`, `enabled` (bool, default true), `severity` (enum Low/Medium/High/Critical), `category` (text), `ruleType`, `conditions`, `groupBy`, `threshold`, `windowSeconds`, `cooldownSeconds`, `alertEnabled` (bool, default false), `updatedAt`.
  - `siemSettings` columns include `id`, `alertMinSeverity` (enum, default "High").
- **Severity values:** `import { siemSeverities, type SiemSeverity } from "@/lib/siem/types"` → `["Low","Medium","High","Critical"]`.
- **Auth helper:** `import { requireActiveSiteAdminAction } from "@/lib/action-auth"`. Returns `{ ok: true, ... }` or `{ ok: false, message: string }`. Existing actions return `{ message }` to the form on `!ok`.
- **Audit:** `import { logAudit } from "@/lib/audit"`. Call shape used elsewhere: `await logAudit({ action: "UPDATE", entity: "settings", entityName: "SIEM Rules", detail: "..." })`.
- **Action conventions:** server actions live in `actions/*.ts`, start with `"use server"`, validate with Zod, return `{ message }` (auth fail), `{ errors }` (validation fail), or `{ success: true }`, and call `revalidatePath(...)`.
- **Form pattern to copy:** `components/admin/siem-ingest-settings-form.tsx` (client, `useActionState(action, undefined)`, `router.refresh()` on success, error/success banners, `ActionButton type="submit" isPending={isPending}`).
- **Page guard pattern to copy:** `app/(dashboard)/admin/siem/page.tsx` (`verifySession()`, redirect non-admins to `/checklist`, redirect if no `activeSiteId`, render `PageHeader` + handle `{ message }` error shape).
- **ActionButton:** `@/components/ui/action-button` — props include `href`, `variant` ("primary"|"secondary"|"danger"|"ghost"), `icon`, `type`, `isPending`, `disabled`, `children`.
- **Navbar:** `components/ui/navbar.tsx` — top nav. `isAdmin = ["admin","superadmin"].includes(user.role)`. Nav links use `navLinkClass(path)` and `isActive(path)`.

---

## File Structure

- **Modify** `lib/siem/rule-runner.ts` — extract `RESEED_PRESERVE_USER_TOGGLES` column set; stop overwriting `enabled`/`alertEnabled` on conflict.
- **Create** `lib/siem/rule-runner.test.ts` — test the conflict-update column set omits user toggles.
- **Create** `lib/siem/rule-settings-form.ts` — pure helpers `clampRuleToggle` and `parseSiemRulesFormData`.
- **Create** `lib/siem/rule-settings-form.test.ts` — test clamp + parse.
- **Modify** `actions/siem-settings.ts` — add `getSiemRules` and `updateSiemRules`.
- **Create** `app/(dashboard)/admin/siem/rules/page.tsx` — server component page.
- **Create** `components/admin/siem-rules-form.tsx` — client form.
- **Modify** `app/(dashboard)/admin/siem/page.tsx` — add "Rules" action button.
- **Modify** `components/ui/navbar.tsx` — add "SIEM" link.

---

## Task 1: Re-seed preserves user toggles

**Files:**
- Modify: `lib/siem/rule-runner.ts:125-161`
- Test: `lib/siem/rule-runner.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `lib/siem/rule-runner.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { RESEED_CONFLICT_UPDATE_KEYS } from "./rule-runner";

describe("RESEED_CONFLICT_UPDATE_KEYS", () => {
  it("updates rule metadata from code on re-seed", () => {
    for (const key of ["name", "description", "severity", "category", "ruleType", "conditions", "groupBy", "threshold", "windowSeconds", "cooldownSeconds"]) {
      expect(RESEED_CONFLICT_UPDATE_KEYS).toContain(key);
    }
  });

  it("never overwrites user-controlled toggles on re-seed", () => {
    expect(RESEED_CONFLICT_UPDATE_KEYS).not.toContain("enabled");
    expect(RESEED_CONFLICT_UPDATE_KEYS).not.toContain("alertEnabled");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/siem/rule-runner.test.ts`
Expected: FAIL — `RESEED_CONFLICT_UPDATE_KEYS` is not exported.

- [ ] **Step 3: Implement the change**

In `lib/siem/rule-runner.ts`, replace the `seedDefaultSiemRules` function (currently lines 125-161) with:

```typescript
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

export async function seedDefaultSiemRules(rules: SeedSiemRule[]) {
  for (const rule of rules) {
    await db.insert(siemRules).values({
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
    }).onConflictDoUpdate({
      target: siemRules.key,
      // Refresh metadata from code, but preserve user-set enabled/alertEnabled.
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        severity: sql`excluded.severity`,
        category: sql`excluded.category`,
        ruleType: sql`excluded.rule_type`,
        conditions: sql`excluded.conditions`,
        groupBy: sql`excluded.group_by`,
        threshold: sql`excluded.threshold`,
        windowSeconds: sql`excluded.window_seconds`,
        cooldownSeconds: sql`excluded.cooldown_seconds`,
        updatedAt: new Date(),
      },
    });
  }

  return { seeded: rules.length };
}
```

(The `enabled` and `alertEnabled` lines are removed from the `set` block; the `values(...)` block is unchanged so brand-new rules still get code defaults.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/siem/rule-runner.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/siem/rule-runner.ts lib/siem/rule-runner.test.ts
git commit -m "fix(siem): re-seed preserves user enabled/alertEnabled toggles"
```

---

## Task 2: Pure form parse + clamp helpers

**Files:**
- Create: `lib/siem/rule-settings-form.ts`
- Test: `lib/siem/rule-settings-form.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/siem/rule-settings-form.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { clampRuleToggle, parseSiemRulesFormData } from "./rule-settings-form";

describe("clampRuleToggle", () => {
  it("keeps alertEnabled when the rule is enabled", () => {
    expect(clampRuleToggle({ id: 1, enabled: true, alertEnabled: true })).toEqual({ id: 1, enabled: true, alertEnabled: true });
  });

  it("forces alertEnabled off when the rule is disabled", () => {
    expect(clampRuleToggle({ id: 2, enabled: false, alertEnabled: true })).toEqual({ id: 2, enabled: false, alertEnabled: false });
  });
});

describe("parseSiemRulesFormData", () => {
  it("reads ruleIds and per-rule checkboxes, clamping alert to enabled", () => {
    const fd = new FormData();
    fd.set("ruleIds", "1,2,3");
    fd.set("alertMinSeverity", "Low");
    // rule 1: enabled + alert
    fd.set("enabled-1", "on");
    fd.set("alert-1", "on");
    // rule 2: enabled only
    fd.set("enabled-2", "on");
    // rule 3: disabled but alert checked -> clamped off
    fd.set("alert-3", "on");

    const result = parseSiemRulesFormData(fd);
    expect(result.alertMinSeverity).toBe("Low");
    expect(result.rules).toEqual([
      { id: 1, enabled: true, alertEnabled: true },
      { id: 2, enabled: true, alertEnabled: false },
      { id: 3, enabled: false, alertEnabled: false },
    ]);
  });

  it("throws on an invalid alertMinSeverity", () => {
    const fd = new FormData();
    fd.set("ruleIds", "1");
    fd.set("alertMinSeverity", "Bogus");
    fd.set("enabled-1", "on");
    expect(() => parseSiemRulesFormData(fd)).toThrow();
  });

  it("ignores empty ruleIds", () => {
    const fd = new FormData();
    fd.set("ruleIds", "");
    fd.set("alertMinSeverity", "High");
    const result = parseSiemRulesFormData(fd);
    expect(result.rules).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/siem/rule-settings-form.test.ts`
Expected: FAIL — module `./rule-settings-form` not found.

- [ ] **Step 3: Implement the helpers**

Create `lib/siem/rule-settings-form.ts`:

```typescript
import { siemSeverities, type SiemSeverity } from "./types";

export type RuleToggle = { id: number; enabled: boolean; alertEnabled: boolean };

// A disabled rule can never alert, so alertEnabled is forced off when !enabled.
export function clampRuleToggle(toggle: RuleToggle): RuleToggle {
  return { ...toggle, alertEnabled: toggle.enabled ? toggle.alertEnabled : false };
}

function isSeverity(value: unknown): value is SiemSeverity {
  return typeof value === "string" && (siemSeverities as readonly string[]).includes(value);
}

export function parseSiemRulesFormData(formData: FormData): {
  alertMinSeverity: SiemSeverity;
  rules: RuleToggle[];
} {
  const severity = formData.get("alertMinSeverity");
  if (!isSeverity(severity)) throw new Error("Invalid alertMinSeverity");

  const idsRaw = String(formData.get("ruleIds") ?? "").trim();
  const ids = idsRaw ? idsRaw.split(",").map((part) => Number(part.trim())).filter((n) => Number.isInteger(n) && n > 0) : [];

  const rules = ids.map((id) =>
    clampRuleToggle({
      id,
      enabled: formData.get(`enabled-${id}`) === "on",
      alertEnabled: formData.get(`alert-${id}`) === "on",
    }),
  );

  return { alertMinSeverity: severity, rules };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/siem/rule-settings-form.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/siem/rule-settings-form.ts lib/siem/rule-settings-form.test.ts
git commit -m "feat(siem): add pure parse/clamp helpers for rule alert settings form"
```

---

## Task 3: Server actions `getSiemRules` and `updateSiemRules`

**Files:**
- Modify: `actions/siem-settings.ts`

- [ ] **Step 1: Add imports**

At the top of `actions/siem-settings.ts`, ensure these are imported. The file already imports `db`, `requireActiveSiteAdminAction`, `logAudit`, `siemSeverities`, `eq`, `revalidatePath`, `z`, and from `@/db/schema` it imports `siemSettings, sites`. Update the schema import to also include `siemRules`, and add the form helper import:

```typescript
import { siemRules, siemSettings, sites } from "@/db/schema";
import { parseSiemRulesFormData } from "@/lib/siem/rule-settings-form";
import { asc, eq } from "drizzle-orm";
```

(`asc` is already imported in this file; keep a single `drizzle-orm` import line containing both `asc` and `eq`.)

- [ ] **Step 2: Add `getSiemRules` at the end of the file**

```typescript
const SEVERITY_RANK: Record<(typeof siemSeverities)[number], number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };

export async function getSiemRules() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const rules = await db
    .select({
      id: siemRules.id,
      key: siemRules.key,
      name: siemRules.name,
      description: siemRules.description,
      category: siemRules.category,
      severity: siemRules.severity,
      enabled: siemRules.enabled,
      alertEnabled: siemRules.alertEnabled,
    })
    .from(siemRules);

  rules.sort((a, b) =>
    a.category === b.category
      ? SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.name.localeCompare(b.name)
      : a.category.localeCompare(b.category),
  );

  const [settings] = await db.select({ alertMinSeverity: siemSettings.alertMinSeverity }).from(siemSettings).limit(1);

  return {
    rules,
    alertMinSeverity: (settings?.alertMinSeverity ?? "High") as (typeof siemSeverities)[number],
  };
}
```

- [ ] **Step 3: Add `updateSiemRules` at the end of the file**

```typescript
export async function updateSiemRules(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  let parsed;
  try {
    parsed = parseSiemRulesFormData(formData);
  } catch {
    return { errors: { alertMinSeverity: ["Data form rule tidak valid."] } };
  }

  await db.transaction(async (tx) => {
    for (const rule of parsed.rules) {
      await tx
        .update(siemRules)
        .set({ enabled: rule.enabled, alertEnabled: rule.alertEnabled, updatedAt: new Date() })
        .where(eq(siemRules.id, rule.id));
    }

    const [existing] = await tx.select({ id: siemSettings.id }).from(siemSettings).limit(1);
    if (existing) {
      await tx.update(siemSettings).set({ alertMinSeverity: parsed.alertMinSeverity, updatedAt: new Date() }).where(eq(siemSettings.id, existing.id));
    } else {
      await tx.insert(siemSettings).values({ alertMinSeverity: parsed.alertMinSeverity });
    }
  });

  await logAudit({ action: "UPDATE", entity: "settings", entityName: "SIEM Rules", detail: `Updated ${parsed.rules.length} rule(s), min severity ${parsed.alertMinSeverity}` });
  revalidatePath("/admin/siem/rules");
  return { success: true };
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: `No errors found`. If `asc` becomes unused after your edits, remove it from the import to satisfy lint; if `getSiemIngestSettings` still uses `asc`, leave it.

- [ ] **Step 5: Commit**

```bash
git add actions/siem-settings.ts
git commit -m "feat(siem): add getSiemRules and updateSiemRules server actions"
```

---

## Task 4: Rules client form

**Files:**
- Create: `components/admin/siem-rules-form.tsx`

- [ ] **Step 1: Create the component**

Create `components/admin/siem-rules-form.tsx`:

```tsx
"use client";

import { updateSiemRules } from "@/actions/siem-settings";
import ActionButton from "@/components/ui/action-button";
import { siemSeverities, type SiemSeverity } from "@/lib/siem/types";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";

export type SiemRuleRow = {
  id: number;
  key: string;
  name: string;
  description: string;
  category: string;
  severity: SiemSeverity;
  enabled: boolean;
  alertEnabled: boolean;
};

type ToggleState = Record<number, { enabled: boolean; alertEnabled: boolean }>;

export default function SiemRulesForm({ rules, alertMinSeverity }: { rules: SiemRuleRow[]; alertMinSeverity: SiemSeverity }) {
  const router = useRouter();
  const [state, action, isPending] = useActionState(updateSiemRules, undefined);
  const [toggles, setToggles] = useState<ToggleState>(() =>
    Object.fromEntries(rules.map((rule) => [rule.id, { enabled: rule.enabled, alertEnabled: rule.alertEnabled }])),
  );

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  const grouped = useMemo(() => {
    const map = new Map<string, SiemRuleRow[]>();
    for (const rule of rules) {
      const list = map.get(rule.category) ?? [];
      list.push(rule);
      map.set(rule.category, list);
    }
    return [...map.entries()];
  }, [rules]);

  const setEnabled = (id: number, value: boolean) =>
    setToggles((prev) => ({ ...prev, [id]: { enabled: value, alertEnabled: value ? prev[id].alertEnabled : false } }));
  const setAlert = (id: number, value: boolean) =>
    setToggles((prev) => ({ ...prev, [id]: { ...prev[id], alertEnabled: value } }));

  const ruleIds = rules.map((rule) => rule.id).join(",");

  return (
    <form action={action} className="mt-6 space-y-6">
      <input type="hidden" name="ruleIds" value={ruleIds} />

      <div className="max-w-md rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
        <label className="space-y-1.5 text-sm font-medium text-slate-300">
          Severity Minimum Alert
          <select
            name="alertMinSeverity"
            defaultValue={alertMinSeverity}
            className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white"
          >
            {siemSeverities.map((severity) => (
              <option key={severity} value={severity}>{severity}</option>
            ))}
          </select>
          <span className="text-xs text-slate-500">Finding di bawah severity ini tidak masuk antrean alert Telegram.</span>
        </label>
      </div>

      {grouped.map(([category, list]) => (
        <div key={category} className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
          <h2 className="text-sm font-semibold text-white">{category}</h2>
          <div className="mt-4 divide-y divide-slate-700/40">
            {list.map((rule) => {
              const current = toggles[rule.id];
              return (
                <div key={rule.id} className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{rule.name}</span>
                      <span className="rounded-full border border-slate-600 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{rule.severity}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{rule.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-5">
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        name={`enabled-${rule.id}`}
                        checked={current.enabled}
                        onChange={(event) => setEnabled(rule.id, event.target.checked)}
                        className="size-4 accent-blue-500"
                      />
                      Aktif
                    </label>
                    <label className={`flex items-center gap-2 text-xs ${current.enabled ? "text-slate-300" : "text-slate-600"}`}>
                      <input
                        type="checkbox"
                        name={`alert-${rule.id}`}
                        checked={current.alertEnabled}
                        disabled={!current.enabled}
                        onChange={(event) => setAlert(rule.id, event.target.checked)}
                        className="size-4 accent-emerald-500 disabled:opacity-40"
                      />
                      Kirim ke Telegram
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {state?.errors && (
        <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">
          {Object.values(state.errors).flat().join(" ")}
        </div>
      )}
      {state?.message && !state.success && (
        <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">{state.message}</div>
      )}
      {state?.success && (
        <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300">Pengaturan rule tersimpan.</div>
      )}

      <div className="flex justify-end">
        <ActionButton type="submit" isPending={isPending}>Simpan Pengaturan Rule</ActionButton>
      </div>
    </form>
  );
}
```

Note on checkbox + form submission: native checkboxes only submit when checked, sending value `"on"`. The hidden `ruleIds` input drives parsing on the server (`parseSiemRulesFormData` iterates those ids and treats a missing checkbox as `false`), so unchecked rows are handled correctly.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 3: Commit**

```bash
git add components/admin/siem-rules-form.tsx
git commit -m "feat(siem): add rule alert settings client form"
```

---

## Task 5: Rules page (server component)

**Files:**
- Create: `app/(dashboard)/admin/siem/rules/page.tsx`

- [ ] **Step 1: Create the page**

Create `app/(dashboard)/admin/siem/rules/page.tsx`:

```tsx
import { getSiemRules } from "@/actions/siem-settings";
import SiemRulesForm, { type SiemRuleRow } from "@/components/admin/siem-rules-form";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function SiemRulesPage() {
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");
  if (!session.activeSiteId) redirect("/select-site");

  const data = await getSiemRules();

  if ("message" in data) {
    return (
      <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-4 py-5 lg:px-6">
        <PageHeader eyebrow="Admin / SIEM" title="SIEM Rules" description="Atur rule mana yang aktif dan mana yang mengirim alert ke Telegram." />
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{data.message}</div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader eyebrow="Admin / SIEM" title="SIEM Rules" description="Atur rule mana yang aktif dan mana yang mengirim alert ke Telegram." />
      <SiemRulesForm rules={data.rules as SiemRuleRow[]} alertMinSeverity={data.alertMinSeverity} />
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/admin/siem/rules/page.tsx"
git commit -m "feat(siem): add /admin/siem/rules page"
```

---

## Task 6: "Rules" action button on the SIEM dashboard

**Files:**
- Modify: `app/(dashboard)/admin/siem/page.tsx:6` (import) and `:36-41` (actions row)

- [ ] **Step 1: Add the icon import**

Change line 6 from:

```tsx
import { FileSearch, RadioTower, ScrollText, ShieldAlert } from "lucide-react";
```

to:

```tsx
import { FileSearch, RadioTower, ScrollText, ShieldAlert, SlidersHorizontal } from "lucide-react";
```

- [ ] **Step 2: Add the Rules button**

In the `actions={ ... }` block (both occurrences are in one place, the second `return`), add a Rules button after the Sources button so it reads:

```tsx
            <ActionButton href="/admin/siem/syslog" variant="secondary" icon={<ScrollText className="size-4" />}>Syslog</ActionButton>
            <ActionButton href="/admin/siem/events" variant="secondary" icon={<FileSearch className="size-4" />}>Events</ActionButton>
            <ActionButton href="/admin/siem/findings" variant="secondary" icon={<ShieldAlert className="size-4" />}>Findings</ActionButton>
            <ActionButton href="/admin/siem/sources" variant="secondary" icon={<RadioTower className="size-4" />}>Sources</ActionButton>
            <ActionButton href="/admin/siem/rules" variant="secondary" icon={<SlidersHorizontal className="size-4" />}>Rules</ActionButton>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/admin/siem/page.tsx"
git commit -m "feat(siem): add Rules action button to SIEM dashboard"
```

---

## Task 7: "SIEM" link in the navbar

**Files:**
- Modify: `components/ui/navbar.tsx:113-115` (nav links region)

- [ ] **Step 1: Add the link**

In the `<nav className="hidden md:flex ...">` block, add a SIEM link, admin-only, right after the Incidents link. The region currently is:

```tsx
                        <Link href="/admin/incidents" className={navLinkClass("/admin/incidents")}>Incidents</Link>
                        <Link href="/grid" className={navLinkClass("/grid")}>Grid View</Link>
```

Change it to:

```tsx
                        <Link href="/admin/incidents" className={navLinkClass("/admin/incidents")}>Incidents</Link>
                        {isAdmin && (
                            <Link href="/admin/siem" className={navLinkClass("/admin/siem")}>SIEM</Link>
                        )}
                        <Link href="/grid" className={navLinkClass("/grid")}>Grid View</Link>
```

(`isAdmin` and `navLinkClass` already exist in this component.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 3: Commit**

```bash
git add components/ui/navbar.tsx
git commit -m "feat(siem): add admin-only SIEM link to navbar"
```

---

## Task 8: Full verification

- [ ] **Step 1: Run the full SIEM test suite**

Run: `npx vitest run lib/siem`
Expected: PASS, 0 failures (includes the new `rule-runner.test.ts` and `rule-settings-form.test.ts`).

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 3: Production build (catches App Router issues)**

Run: `npx next build`
Expected: build succeeds; `/admin/siem/rules` appears in the route list.

- [ ] **Step 4: Commit anything outstanding (if needed)**

```bash
git add -A
git commit -m "chore(siem): rule alert settings + navbar SIEM link"
```

---

## Deployment & manual verification (run on the server)

These are `.ts`/`.tsx` changes; the app runs from the compiled `.next` build, and the rule worker shares the same image, so a rebuild is required:

```bash
cd ~/dc-check && git pull
docker compose up -d --build
```

Then:
1. Open the app → confirm the **SIEM** link shows in the navbar (admin login).
2. Go to **SIEM → Rules** (`/admin/siem/rules`).
3. Find **Deny burst from same source** (Firewall) → enable **Kirim ke Telegram** → **Simpan Pengaturan Rule**.
4. Within ~15s (one worker cycle), the existing finding(s) #3/#4 should arrive in the Telegram group, because they have no telegram alert row yet.
5. Optional: `docker exec dccheck_app node scripts/check-siem-alert.js` — the deny-burst findings should now show `OK -> should queue` (or already have a sent alert row).
6. Restart the stack again and re-open Rules to confirm the toggle **persisted** (re-seed no longer resets it).

---

## Self-review notes (already applied)

- **Spec coverage:** navbar link (Task 7), Rules action button (Task 6), Rules page (Task 5), form with per-rule Aktif + Kirim-Telegram toggles and global min severity (Task 4), `getSiemRules`/`updateSiemRules` (Task 3), re-seed preservation (Task 1), `alertEnabled ⇒ enabled` clamp (Task 2 + enforced server-side via the parsed/clamped data in Task 3). All covered.
- **Type consistency:** `RuleToggle`, `parseSiemRulesFormData`, `clampRuleToggle`, `SiemRuleRow`, `RESEED_CONFLICT_UPDATE_KEYS` names are used identically across tasks. Form field names (`ruleIds`, `enabled-<id>`, `alert-<id>`, `alertMinSeverity`) match between the form (Task 4) and the parser (Task 2).
- **No placeholders:** every code/command step contains the full content.
