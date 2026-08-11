# Data Center Blueprint UI/UX Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve DC-Check from a generic ops dashboard into an interface with its own industrial/physical identity — technical typography, LED status language, and blueprint texture — while keeping light/dark themes and all current flows working.

**Architecture:** Token-driven. Stage 1 reworks `globals.css` design tokens + fonts (visible app-wide with zero component churn). Stage 2 adds reusable primitives (`LedDot`, `LedChip`, `StatusStripe`, `RailStepper`) built on the existing `UiTone`/`StatusBadge` convention, then swaps them into key surfaces. Stage 3 refines the highest-signal UX surfaces (rack, scanner, reports) using existing dnd-kit/scanner code. No new dependencies; CSS-only motion.

**Tech Stack:** Next.js 16 (App Router), Tailwind CSS v4 (`@theme` + `.dark`, `@custom-variant dark` already active), `next/font/google` + Google Fonts `<link>`, `clsx`, `lucide-react`, `@dnd-kit/core`, vitest. No new packages.

## Global Constraints

- **No new dependencies.** All visual language via CSS tokens, `color-mix`, and existing libs.
- **Fonts:** `JetBrains Mono` for all IDs/resource names/timestamps/status codes; `Space Grotesk` for technical titles; `Inter` for body. Load via `next/font/google` (layout) + `--font-mono` token.
- **Keep `UiTone`** (`@/lib/ui/status`) as the single status type; new LED components consume it.
- **Both themes** (light `.dark` off / dark `.dark` on) must resolve correctly for every new token/component.
- **Accessibility:** visible focus ring (2-4px) on all interactive elements; `prefers-reduced-motion` respected (no pulse/transition for users who request reduced motion); color is never the only status indicator (LED lamp always pairs with label/glyph); touch targets ≥44px on mobile for scan/rack/CTA.
- **Motion:** animated only 1-2 key elements per view; LED pulse reserved for genuinely live/danger states, not decorative.
- **Tailwind v4** — tokens are CSS vars in `@theme`; reference as `bg-surface`, `text-ops-accent`, etc.
- **Existing `dark:` classes and `ops-*` token names stay valid** — only values/helpers change.
- `next build` must stay green after every commit.
- Tools: `npx next build`, `npx vitest run`.

---

### Task 1: Design tokens + fonts in globals.css

**Files:**
- Modify: `app/globals.css` — extend `@theme` + `.dark` blocks, add body font fallback
- Modify: `app/layout.tsx` — add `JetBrains_Mono` via `next/font/google`, set `--font-mono` and `--font-display` variables

**Interfaces:**
- Consumes: existing `@theme`/`.dark` structure, existing `--color-ops-*` names.
- Produces: new CSS vars `--font-mono`, `--font-display`, `--color-blueprint-grid`, `--color-led-ok`, `--color-led-warn`, `--color-led-danger`, `--color-led-neutral`. Later components consume these tokens.

- [ ] **Step 1: Add mono + display fonts to `app/layout.tsx`**

```tsx
// app/layout.tsx — imports
import { Geist, Geist_Mono, JetBrains_Mono, Space_Grotesk } from "next/font/google";

const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });
```

Attach both variables to `<body>`:

```tsx
<body className={`${jetbrainsMono.variable} ${spaceGrotesk.variable} font-sans antialiased bg-background text-foreground min-h-screen flex flex-col`}>
```

- [ ] **Step 2: Extend `@theme` in `app/globals.css`** with mono + blueprint grid + LED tokens

```css
@theme {
  /* existing tokens unchanged */
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  --font-display: "Space Grotesk", "Inter", sans-serif;
  --color-blueprint-grid: #d6dce2; /* light default */
  --color-led-ok: #22c55e;
  --color-led-warn: #fb8500;
  --color-led-danger: #ef233c;
  --color-led-neutral: #94a3b8;
}
```

- [ ] **Step 3: Add `.dark` overrides** for the new tokens

```css
.dark {
  /* existing overrides unchanged */
  --color-blueprint-grid: #1e293b;
  --color-led-ok: #34d399;
  --color-led-warn: #fb8500;
  --color-led-danger: #ef233c;
  --color-led-neutral: #64748b;
}
```

- [ ] **Step 4: Auto-apply mono to technical text** — add a base rule so `font-mono` is the default for IDs/timestamps without per-element classes

```css
/* globals.css base */
code, kbd, samp, .font-mono {
  font-family: var(--font-mono);
}
/* tabular figures for numeric columns */
.mono-tnum {
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4b: Add accessibility + reduced-motion base rules**

```css
/* globals.css base */
:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
  border-radius: 4px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 5: Verify build**

Run: `npx next build`
Expected: `✓ Compiled successfully`, `0 errors`

- [ ] **Step 6: Commit**

```bash
git add app/globals.css app/layout.tsx
git commit -m "feat(theme): add mono/display fonts and blueprint+LED tokens"
```

---

### Task 2: LED status primitives

**Files:**
- Modify: `components/ui/status-badge.tsx` — add `LedDot`/`LedChip` exports sharing `UiTone`
- Create: `components/ui/status-stripe.tsx`
- Test: `components/ui/status-badge.test.tsx`

**Interfaces:**
- Consumes: `UiTone` + `toneClasses`/`dotClasses` maps already in `status-badge.tsx`.
- Produces: `LedChip` (tone + optional label + optional pulse), `LedDot` (size variant), `StatusStripe` (tone → 2px gradient line). Later tasks (reports, incident, dashboard) import these.

- [ ] **Step 1: Write failing tests**

```tsx
// components/ui/status-badge.test.tsx
import { render, screen } from "@testing-library/react";
import { LedChip } from "./status-badge";

it("maps success tone to ok LED", () => {
  render(<LedChip tone="success">R-07-U12</LedChip>);
  expect(screen.getByText("R-07-U12")).toBeInTheDocument();
});

it("renders pulse class when pulse=true", () => {
  const { container } = render(<LedChip tone="danger" pulse>SI-2031</LedChip>);
  expect(container.querySelector(".motion-safe\\:animate-pulse")).not.toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/ui/status-badge.test.tsx`
Expected: FAIL — `LedChip` not exported

- [ ] **Step 3: Implement `LedDot` + `LedChip` in `status-badge.tsx`**

```tsx
export function LedDot({ tone = "neutral", pulse = false, className }: { tone?: UiTone; pulse?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx("inline-block rounded-full", pulse && "motion-safe:animate-pulse", dotClasses[tone], className)}
      style={{ width: "0.5em", height: "0.5em" }}
    />
  );
}

export function LedChip({ tone = "neutral", pulse = false, children, className }: { tone?: UiTone; pulse?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none", toneClasses[tone], className)}>
      <LedDot tone={tone} pulse={pulse} />
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/ui/status-badge.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Create `status-stripe.tsx`**

```tsx
import type { UiTone } from "@/lib/ui/status";
import clsx from "clsx";

const stripeColors: Record<UiTone, string> = {
  neutral: "bg-slate-400",
  success: "bg-emerald-400",
  warning: "bg-amber-400",
  orange: "bg-orange-400",
  danger: "bg-red-400",
  info: "bg-blue-400",
  accent: "bg-ops-accent",
  purple: "bg-purple-400",
};

export default function StatusStripe({ tone = "neutral", className }: { tone?: UiTone; className?: string }) {
  return <div aria-hidden className={clsx("h-0.5 w-full rounded-full", stripeColors[tone], className)} />;
}
```

- [ ] **Step 6: Commit**

```bash
git add components/ui/status-badge.tsx components/ui/status-badge.test.tsx components/ui/status-stripe.tsx
git commit -m "feat(ui): add LedDot/LedChip/StatusStripe primitives"
```

---

### Task 3: RailStepper for audit flow

**Files:**
- Create: `components/ui/rail-stepper.tsx`
- Test: `components/ui/rail-stepper.test.tsx`

**Interfaces:**
- Consumes: nothing (self-contained).
- Produces: `RailStepper` — `{ steps: string[]; current: number }` (0-indexed), renders a horizontal rail with mono step labels, active step highlighted with accent line. Later wired into audit scan flow.

- [ ] **Step 1: Write failing test**

```tsx
// components/ui/rail-stepper.test.tsx
import { render, screen } from "@testing-library/react";
import RailStepper from "./rail-stepper";

it("renders all steps and marks active", () => {
  render(<RailStepper steps={["Scan", "Device", "Checklist", "Submit"]} current={1} />);
  expect(screen.getByText("Scan")).toBeInTheDocument();
  expect(screen.getByText("Device")).toBeInTheDocument();
  expect(screen.getByText("Checklist")).toBeInTheDocument();
  expect(screen.getByText("Submit")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run components/ui/rail-stepper.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `rail-stepper.tsx`**

```tsx
import clsx from "clsx";

export default function RailStepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-1 overflow-x-auto" aria-label="Audit progress">
      {steps.map((step, i) => {
        const active = i === current;
        const done = i < current;
        return (
          <li key={step} className="flex items-center gap-1">
            {i > 0 && <span className="h-px w-4 bg-border shrink-0" />}
            <span
              className={clsx(
                "whitespace-nowrap px-2 py-1 font-mono text-xs uppercase tracking-wide",
                active && "text-ops-accent",
                done && "text-ops-muted line-through",
                !active && !done && "text-ops-muted/60",
              )}
            >
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run components/ui/rail-stepper.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/ui/rail-stepper.tsx components/ui/rail-stepper.test.tsx
git commit -m "feat(ui): add RailStepper audit progress rail"
```

---

### Task 4: Swap LED language into reports + grid

**Files:**
- Modify: `components/ui/data-table.tsx`, `components/ui/data-toolbar.tsx` (if present)
- Modify: `app/[locale]/(dashboard)/report/page.tsx`
- Search: `components/admin/*table.tsx`, `components/admin/siem-*.tsx` for `StatusBadge` usages

**Interfaces:**
- Consumes: `LedChip`/`LedDot` from Task 2.
- Produces: consistent LED status rendering across report grid + admin tables.

- [ ] **Step 1: Replace bare `StatusBadge` status text in report grid with `LedChip`**

In `app/[locale]/(dashboard)/report/page.tsx`, find status renderings (e.g. `OK`/`Warning`/`Error` text or `StatusBadge`) and swap to `<LedChip tone={...}>` using the same `UiTone` mapping. Keep labels (e.g. `OK`, `Warning`) as children.

- [ ] **Step 2: Add a summary bar** above the report grid — total OK / Warning / Error devices for the current filter.

```tsx
// inside report page, above the table
<div className="flex items-center gap-4 px-1 pb-2 font-mono text-xs">
  <LedChip tone="success">{okCount} OK</LedChip>
  <LedChip tone="warning">{warnCount} Warning</LedChip>
  <LedChip tone="danger">{errCount} Error</LedChip>
</div>
```

Compute counts from the same data array already loaded by the page.

- [ ] **Step 3: Sweep admin/siem tables** — replace `<StatusBadge tone=...>` with `<LedChip tone=...>` where the badge is purely a status indicator (keep `StatusBadge` where a label-without-LED is intentional). Use `LedDot` for inline status dots in table cells.

- [ ] **Step 4: Verify build + tests**

Run: `npx next build && npx vitest run`
Expected: build green, tests pass

- [ ] **Step 5: Commit**

```bash
git add app/[locale]/(dashboard)/report/page.tsx components/ui/data-table.tsx components/admin/
git commit -m "feat(ui): LED status language across reports and tables"
```

---

### Task 5: Rack visual blueprint refinement

**Files:**
- Modify: `components/admin/rack-layout.tsx` — slot styling, hot-middle rail, capacity meter, mono U labels

**Interfaces:**
- Consumes: existing dnd-kit drag-drop already in `rack-layout.tsx`.
- Produces: refined visual (blueprint slots, hot rail, capacity bar) — no behavior change.

- [ ] **Step 1: Blueprint slot styling** — adjust empty-slot classes to a hatch/grid feel and mono U labels

Replace empty-slot classes in `DroppableSlot`:
```tsx
: "bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(100,116,139,0.08)_4px,rgba(100,116,139,0.08)_8px)] border border-dashed border-ops-border hover:border-ops-accent/50"
```

- [ ] **Step 2: Add hot-middle rail** — a vertical accent strip on the rack spine (the column between U numbers and slots) to read as a "rack rail".

Add a thin accent column in the rack grid rendering (next to the U-number column), `w-0.5 bg-ops-accent/40`, spanning the rack height.

- [ ] **Step 3: Add capacity meter** — per-rack fill bar showing `occupied/total` U.

```tsx
const fill = occupied / total;
< div className="h-1 w-full rounded-full bg-ops-border">
  <div className="h-full rounded-full bg-ops-accent" style={{ width: `${fill * 100}%` }} />
</div>
```

- [ ] **Step 4: Verify build**

Run: `npx next build`
Expected: green

- [ ] **Step 5: Commit**

```bash
git add components/admin/rack-layout.tsx
git commit -m "feat(rack): blueprint slots, hot rail, capacity meter"
```

---

### Task 6: Scanner reticle frame

**Files:**
- Modify: `app/[locale]/audit/scan/scanner-client.tsx` — wrap video viewport with reticle + telemetry corners

**Interfaces:**
- Consumes: existing scanner logic (camera + QR decode already present).
- Produces: reticle overlay frame + corner marks + post-scan status LED.

- [ ] **Step 1: Add reticle overlay** — absolutely-positioned frame over the video with corner marks and a center reticle.

```tsx
<div className="pointer-events-none absolute inset-0">
  <div className="absolute inset-6 rounded-lg border-2 border-ops-accent/60" />
  {/* corner marks */}
  {["top-left","top-right","bottom-left","bottom-right"].map((c) => (
    <span key={c} className={`absolute size-4 border-ops-accent ${cornerClass(c)}`} />
  ))}
</div>
```

- [ ] **Step 2: Post-scan status LED** — after a successful decode, show a `LedChip tone="success"` "Device matched" readout with the device ID in mono.

- [ ] **Step 3: Verify build**

Run: `npx next build`
Expected: green

- [ ] **Step 4: Commit**

```bash
git add app/[locale]/audit/scan/scanner-client.tsx
git commit -m "feat(scan): reticle frame and post-scan LED status"
```

---

### Task 7: Dashboard + incident LED pulse

**Files:**
- Modify: `components/admin/siem-dashboard.tsx`, `components/admin/incident-table.tsx`, `components/admin/incident-detail.tsx`
- Modify: `components/ui/stats-card.tsx` — add optional `trend`/`live` prop for LED pulse

**Interfaces:**
- Consumes: `LedDot`/`LedChip`/`StatusStripe` from Task 2.
- Produces: living status feel — pulsing live LEDs on active incidents/alerts, StatusStripe on card headers.

- [ ] **Step 1: Add `StatusStripe` to `stats-card.tsx`** — optional `tone` prop renders a stripe at card top.

```tsx
import StatusStripe from "./status-stripe";
// in StatsCard, when tone provided:
{tone && <StatusStripe tone={tone} className="absolute top-0 left-0 right-0 rounded-none" />}
```

- [ ] **Step 2: Pulse active/danger LEDs** — in incident table + SIEM dashboard, use `LedChip tone="danger" pulse` for open/critical incidents, `LedDot pulse` for live alerts. **Use `motion-safe:animate-pulse`** (Tailwind variant) so users with reduced-motion get a static lamp — the `prefers-reduced-motion` base from Task 1 also covers this, but `motion-safe:` keeps the pulse class itself inert for those users. Limit pulse to live/danger only (1-2 per view max, per Global Constraints).

- [ ] **Step 3: Verify build + tests**

Run: `npx next build && npx vitest run`
Expected: green

- [ ] **Step 4: Commit**

```bash
git add components/admin/siem-dashboard.tsx components/admin/incident-table.tsx components/admin/incident-detail.tsx components/ui/stats-card.tsx
git commit -m "feat(ui): LED pulse + status stripes on dashboard and incidents"
```

---

### Task 8: Final integration + full check

**Files:**
- Modify: `app/[locale]/(dashboard)/layout.tsx` — apply mono/display font classes to shell if needed
- Verify: `app/[locale]/login/page.tsx`, `app/[locale]/select-site/page.tsx` render with new tokens

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a coherent, shippable rework.

- [ ] **Step 1: Font application sweep** — ensure IDs/timestamps across visible surfaces use `font-mono` (add `font-mono` class where a technical value shows but isn't yet mono). Focus: login, select-site, page headers, dashboard, report.

- [ ] **Step 2: Manual dual-theme check** — run `npx next dev`, toggle theme, verify in **both** light and dark:
  - blueprint grid, LED colors, mono font resolve correctly
  - body text contrast ≥4.5:1 (light: dark text on light bg; dark: light text on `#0D1117`)
  - borders/dividers visible in both modes (not disappearing in one)
  - modal scrim isolates foreground (not washed out)
  - LED status readable with color + glyph together
  - focus ring visible on tab through
  - `prefers-reduced-motion` enabled → LED pulse stops, transitions snap

- [ ] **Step 3: Full test + build**

Run: `npx vitest run && npx next build`
Expected: all tests pass, build green

- [ ] **Step 4: Commit**

```bash
git add app/components && git add -A
git commit -m "feat(ui): Data Center Blueprint — final integration"
```

---

## Self-Review

**Spec coverage:**
- Technical typography (mono IDs) → Task 1 (fonts/token) + Task 8 (sweep). ✓
- LED status language → Task 2 (primitives) + Task 4/7 (adoption). ✓
- Blueprint texture → Task 1 (blueprint-grid token) + Task 5 (rack). ✓
- RailStepper → Task 3. ✓ Rack interactive → Task 5 (visual only; dnd already exists). ✓
- Scanner reticle → Task 6. ✓ Reports summary bar → Task 4. ✓
- Both themes, no new deps, build green → Global Constraints + every task's verify step. ✓
- Tests → Task 2 real tests; others use build/manual check (visual theme). ✓

**Placeholder scan:** No TBD/TODO. All code blocks concrete. Task 4 Step 1/3 reference "find status renderings" — acceptable as it's a locate-then-swap mechanical step; the exact `UiTone` mapping is defined in Task 2.

**Type consistency:** `LedChip`/`LedDot`/`StatusStripe`/`RailStepper` names and signatures consistent across all tasks. `UiTone` reused throughout. `--font-mono`/`--font-display`/`--color-blueprint-grid`/`--color-led-*` tokens defined in Task 1, consumed later. ✓

**UX best-practice coverage (ui-ux-pro-max):**
- Accessibility: focus rings + reduced-motion base (Task 1 Step 4b); touch targets in Global Constraints; color+glyph not color-only (LED pairs label). ✓
- Motion: `motion-safe:animate-pulse` (Task 2/7), 1-2 animated elements/view max (Global Constraints). ✓
- Typography: mono for data + display for titles (Task 1), tabular-nums. ✓
- Color: semantic tokens, dark+light parity verified (Task 8 Step 2), no raw hex in components (swept in prior theme work). ✓
- Data-dense: LED chips + summary bar in reports (Task 4), tabular figures. ✓