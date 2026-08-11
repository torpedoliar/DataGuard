# DC-Check UI/UX Rework — "Data Center Blueprint"

## Purpose

Evolve DC-Check from the current generic Operations Command Center into an
interface with its own identity: it should read as a tool for auditing
physical data centers — racks, U-slots, status LEDs, telemetry — not a
generic SaaS dashboard. The visual language borrows idioms from hardware
(U slots, status lamps, blueprint grids, etched labels) while remaining a
responsive, theme-aware Next.js app.

Approved direction: **Industrial / Physical (Data Center Blueprint)**.

## Scope

Applies the rework across all main screens:

- App shell & navigation (sidebar + topbar).
- Dashboard.
- Audit entry + QR scanner.
- Rack visual (interactive).
- Incident center list + detail.
- Reports & audit grid.
- Admin inventory, network, SIEM, users, sites, settings, update.
- Login + site selection (keep the map concept, refine visuals only).

Out of scope: database schema changes, server action rewrites, auth
changes, update scripts, external integrations, new unrelated product
features. The global **light/dark theme toggle** (already shipped) is kept
and both modes must be polished together.

## Character

Three pillars distinguish DC-Check from a generic dashboard:

1. **Technical typography.** `JetBrains Mono` for every ID, resource name,
   timestamp, status code, and metric (`DC-JKT`, `R-07-U12`, `2026-08-11`,
   `OK`, `SI-2031`). `Space Grotesk` for technical titles/labels.
   `Inter` for body. Digits use tabular figures (`font-feature-settings: tnum`).
2. **LED status language.** Status is shown as lamps/chips with color +
   glyph, not bare text: `LedDot`/`LedChip` for `OK | Warning | Error |
   Unchecked`, plus a `StatusStripe` (thin gradient line) on card headers
   reflecting last audit result.
3. **Blueprint texture.** Subtle grid/hatch behind headers and rack
   outlines, "etched" inset borders, restrained use of glow/pulse reserved
   for live/online states only.

## Design Tokens (globals.css)

Extend the existing `@theme` + `.dark` block (Tailwind v4, no new deps).
Keep the `ops-*` token names where components already use them, but
repoint values so there is one coherent system.

- Surfaces: deep neutral `#0D1117` (dark) / `#F4F6F9` (light); surface
  `#161B22` / `#FFFFFF`; stroke `#30363D` / `#D6DCE2`.
- Accent: copper-glow teal `#5EEAD4` (dark) / deeper teal for light AA
  contrast; secondary `#FB8500` (warning), `#EF233C` (danger), `#3A86FF`
  (info).
- New tokens: `--color-blueprint-grid`, `--color-led-ok`, `--color-led-warn`,
  `--color-led-danger`, `--color-led-neutral`, `--font-mono`.
- Status + LED tokens must resolve correctly in both `.dark` and light.
- Radius: compact 6-14px; chips/LEDs full-round; buttons small radius.

No image assets — all texture via CSS (linear-gradient hatch, repeating
grid, inset box-shadow).

## Components

New reusable primitives in `components/ui/`:

- `led-chip.tsx` / `led-dot.tsx` — status lamp (OK/Warning/Error/Unchecked).
- `status-stripe.tsx` — thin gradient header line by status.
- `rail-stepper.tsx` — audit step indicator (Scan → Device → Checklist →
  Submit) as a rail.
- Rack visual: 42U column, 18-24px slots, hot-middle rail strip, click for
  device drawer, drag-drop placement on empty U, capacity meter.
- `scan-frame.tsx` — scanner viewport with reticle + telemetry corners.

No new animation dependency (no framer-motion). Motion is CSS only:
`animate-[pulse_1.8s_infinite]` for live LEDs, subtle fade; no parallax.

## Interaction & UX

- **Scan workflow:** QR frame with corner marks + post-scan status; device
  result opens as a device panel that feeds into the checklist. One primary
  CTA per stage; large touch targets for onsite operators; works offline.
- **Rack layout:** click empty/occupied U opens device drawer; drag-drop to
  place devices; reserved U shown as dashed-outline slot. Ops mode is
  read-only board view.
- **Reports/Grid:** audit-grade table — consistent columns, monospaced IDs,
  LED badges, summary bar (total OK/Warning/Error by filter), prominent
  export. Small sparklines via inline SVG, no chart lib.
- **Feedback:** live LED pulse, micro scale on tap, focus rings 3px primary,
  contrast AA, `aria-label`/`role` on rack slots and forms.

## Migration & Risk

- Stage 1: tokens/fonts/theme (visible app-wide).
- Stage 2: reusable components (LED, stripe, rail, rack, scan-frame).
- Stage 3: key UX flows (scan, rack interaction, reports).
- No breaking migration — pages keep working, token names reused.
- Tailwind v4 features used (custom-variant, color-mix) already in place.
- Existing `dark:` and ops-* classes remain valid; only values/helpers change.

## Testing

- Light vitest component tests for status→LED mapping and stepper logic.
- Theme is visual; verified by build + manual light/dark check.
- `next build` must stay green after each stage.