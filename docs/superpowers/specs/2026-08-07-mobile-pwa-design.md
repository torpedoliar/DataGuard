# DataGuard Mobile PWA — Design

**Date:** 2026-08-07
**Status:** Approved (pending spec review)
**Stack:** PWA tune web existing (Next.js 16 App Router, React 19, Tailwind v4, PostgreSQL/Drizzle)
**Approach:** Approach 3 — manual Service Worker + `idb` + responsive tune (no plugin, no Workbox, no native app)

---

## 1. Goals & Non-Goals

### Target users
Mixed **staff lapangan + admin on-call**. Staff: daily audit capture, QR scan, photo evidence, 7-day grid review. Admin: SIEM findings/incident monitoring, ack/close, rack & device status — from anywhere.

### Phase 1 scope (explicit)

**YES:**
- PWA manifest + manual Service Worker (`public/sw.js`, `app/manifest.ts`)
- `idb` dep + `lib/pwa/*` (db, audit-queue, cache-config, register-sw)
- `components/mobile/*` (bottom-nav, mobile-shell, offline-banner)
- `hooks/use-online-status.ts`
- Responsive tune: checklist, grid, SIEM findings, incidents, rack (read-only)
- Offline audit capture + queue + replay via existing `submitChecklist` server action
- Read cache (stale-while-revalidate) for grid, findings, rack
- In-app badge counts (SIEM finding/incident), `navigator.setAppBadge` progressive
- Offline banner + queue UI (view pending, retry, delete)
- Audit-queue vitest self-check (+ `fake-indexeddb` devDep if not present)

**NO — out of scope:**
- Native app (RN/Expo), app store submission
- Web Push / VAPID / push service infra
- Background Sync API (progressive later, iOS gap)
- Offline-first for SIEM/rack mutations or admin (backup, restore, users, rules, settings)
- Biometric / WebAuthn / PIN unlock (auth stays JWT)
- Conflict resolution / dedup logic (append-only)
- New REST API routes (reuse server actions)
- E2E automation (manual path in spec)

### Success criteria
1. Lighthouse PWA audit: installable, basic offline shell.
2. Audit: submit online → appears in grid. Offline → submit → "queued" banner. Online → auto-sync → grid, queue empty.
3. 5 consecutive offline audits queue + replay all on reconnect.
4. SIEM badge updates within 60s of new finding while app open.
5. Existing web desktop UX unchanged (`md:` breakpoints, no layout regression).
6. `npm test` passes (existing + new audit-queue test). `npm run build` clean.

---

## 2. Architecture

No new backend. PWA = client-side layer over existing web app.

```
┌─────────────────────────────────────────────┐
│  Mobile Browser / Installed PWA             │
│  ┌───────────┐  ┌────────────────────────┐  │
│  │ Next.js    │  │ Service Worker         │  │
│  │ App Router │  │ (public/sw.js)        │  │
│  │ + manifest │  │  - shell: cache-first   │  │
│  │            │  │  - read API: SWR       │  │
│  │ (responsive│  │  - audit submit:       │  │
│  │  tune +    │  │    network-only,      │  │
│  │  BottomNav)│  │    fail → client queue │  │
│  └─────┬──────┘  └─────────┬──────────────┘  │
│        │ server actions (JWT cookie auto)    │
│        └────────────────────────────────────┘  │
│                ↕ IndexedDB (idb)              │
│                  - auditQueue                 │
│                  - readCache                  │
│                  - meta (badgeCounts)        │
└────────────────────────────────────────────────┘
                 ↕ HTTPS
        ┌────────────────────┐
        │ Next.js 16 prod    │  ← unchanged
        │ + PostgreSQL       │
        └────────────────────┘
```

### Key decisions
- **No new API routes.** Audit submit replay via existing `submitChecklist` server action, called from a client component when `online` — not from SW. SW only precaches shell + SWR read; unaware of server-action serialization.
- **No new auth.** JWT httpOnly cookie reused fully. `requireActiveSiteAction()` reads existing cookie.
- **One new runtime dep: `idb`** (~1KB). Raw IndexedDB too verbose for queue + cache.
- **SW manual at `public/sw.js`** + register via `app/[locale]/layout.tsx`. No `next-pwa` (Next 16 risk), no Workbox (overkill phase 1).
- **Manifest native Next 16** via `app/manifest.ts`. No plugin.
- **Read cache staleness:** grid 5min, findings 1min, rack 10min. Single source `lib/pwa/cache-config.ts`.

---

## 3. Components & Service Worker

### New files (additions only)

```
public/sw.js                              # manual service worker
app/manifest.ts                           # Next 16 native manifest
lib/pwa/register-sw.ts                    # client-only SW registration
lib/pwa/db.ts                             # idb wrapper: open DB, stores
lib/pwa/audit-queue.ts                    # enqueue/dequeue + replay
lib/pwa/cache-config.ts                   # read-route staleness map
lib/pwa/audit-queue.test.ts               # vitest self-check (self-check for audit-queue)
components/mobile/bottom-nav.tsx           # 5-tab bar
components/mobile/mobile-shell.tsx         # mobile viewport detect + wrap
components/mobile/offline-banner.tsx       # "Offline — N queued" status
hooks/use-online-status.ts                 # online/offline + navigator.connection
```

### Responsive strategy — NO route duplication

Tune existing pages via Tailwind `md:` breakpoints + `BottomNav`. Reasoning: existing `(dashboard)` route group; a separate mobile route group duplicates code + drifts. Mobile-specific components conditionally render via viewport detection.

Existing pages to tune (responsive only, no rewrites):
- `app/[locale]/(dashboard)/checklist/page.tsx` — responsive grid, compact touch targets, bottom-nav
- `app/[locale]/(dashboard)/grid/page.tsx` — horizontal scroll matrix, sticky first column
- `app/[locale]/(dashboard)/admin/siem/findings/page.tsx` — list cards, pull-to-refresh
- `app/[locale]/(dashboard)/admin/incidents/page.tsx` — list + detail sheet
- `app/[locale]/(dashboard)/admin/rack/page.tsx` — read-only mobile view (drag-drop disabled, tap-to-info)

`app/[locale]/layout.tsx` — add SW register script + manifest link (guarded by `navigator.serviceWorker` + viewport).

### Service Worker routing (`public/sw.js`)

```
install:    precache shell (layout CSS, JS chunks, icons, offline fallback HTML)
activate:   clean old caches
fetch:      route by URL pattern
  /_next/static/*         → cache-first (immutable hashed assets)
  /uploads/*              → stale-while-revalidate (photo evidence)
  GET (dashboard pages)  → network-first, fallback cache + offline.html
  GET (read API/json)     → network-first, fallback cache (per cache-config.ts)
  POST (server actions)   → fall-through to network (no cache strategy)
```

**Audit submit is network-only.** SW has no caching strategy for POST — server-action calls fall through to the network. When offline, the `fetch` rejects naturally. The client-side page `onSubmit` wraps the server-action call in try/catch; on rejection, `audit-queue.enqueue()` stores the payload + photo Blobs to IndexedDB. SW never returns a 503 and has no knowledge of form structure. `online` event triggers replay from main thread (not SW) → calls `submitChecklist` via client component. Simpler, transparent.

**Why not Background Sync?** Not in iOS Safari. Progressive enhancement only — manual `online` replay covers iOS. `ponytail: Background Sync optional later if iOS coverage irrelevant and SW replay proves flaky.`

### IndexedDB schema (via idb)

```
DB: dataguard-pwa
store: auditQueue   keyPath: localId (auto)
  {
    localId, clientCreatedAt, siteId, userId,
    checkDate, checkTime, shift,
    items: [{ deviceId, status, remarks, photoBlob }],  // photo as Blob/File
    status: "pending" | "syncing" | "failed",
    attempts: 0, lastError?
  }
store: readCache     keyPath: url
  { url, data, fetchedAt, ttlMs }   // per cache-config.ts
store: meta          key: "badgeCounts"
```

Photo as Blob — `File` persists across replay in IndexedDB. No base64 conversion (waste memory).

---

## 4. Data Flow & Offline Sync

### Online flow (read)

```
User opens /checklist
  → Next.js SSR renders page (JWT cookie → requireActiveSiteAction)
  → client hydrates
  → use-online-status checks navigator.onLine
  → SW intercepts GET read API → network-first
    ├─ network OK → respond + update readCache (SWR)
    └─ network fail/offline → respond from readCache (stale OK) or empty state
```

### Offline flow (audit capture — core)

```
Staff in server room, no signal:
  1. Opens /checklist/new (already SSR'd or cached shell)
  2. Selects shift, scans QR (html5-qrcode existing), captures photo (input[type=file] existing)
  3. Fills status/remarks per device
  4. Taps "Submit"
  5. Page calls submitChecklist() server action → fetch fails (offline)
  6. audit-queue.enqueue() catches the failure:
     - stores {payload + photo Blobs} to IndexedDB auditQueue
     - status: "pending"
     - offline-banner: "Offline — 1 queued"
     - toast: "Saved offline, will sync when back online"
  7. User continues auditing (queue accumulates)

Signal returns:
  8. use-online-status fires 'online'
  9. audit-queue.replay():
     - pick status: "pending", mark "syncing"
     - reconstruct FormData from queued items (photo Blob → File)
     - call submitChecklist() server action
     - success → delete from queue, toast "Synced audit <date> <shift>"
     - failure → attempts++, status back "pending", lastError recorded
       - attempts >= 5 → status: "failed", surface in UI for manual retry
 10. readCache invalidated for grid/findings → next load refetches fresh
```

### Conflict handling — minimal, deliberate

**No conflict resolution logic.** Audits are append-only creates (serial id, no update by date+shift+site). Two offline submissions same date+shift+site → both insert (matches existing web behavior, no uniqueness constraint).

`ponytail: no dedup on offline submit. If duplicate-shift entry becomes real problem, add UNIQUE(siteId, checkDate, shift) constraint at DB level (rung 3: DB constraint over app code), then queue replay surfaces the error to user. Add when duplicate reports come in.`

### Badge counts (in-app alert + badge)

```
SIEM finding/incident counts → polled via existing actions (getSiemFindings with status filter)
  → on dashboard load + 60s interval when app foreground
  → update meta.badgeCounts in IndexedDB
  → navigator.setAppBadge(count) if available (progressive enhancement)
  → bottom-nav shows red dot on SIEM tab
No background push, no SW involvement for badge.
```

### Cache invalidation

```
After successful audit replay → invalidate readCache entries for:
  - /grid (matrix reflects new submission)
  - /checklist?entryId=... (recent entries)
  - /siem/findings (new incident may have been auto-created by submitChecklist)
Don't invalidate rack (audit doesn't change rack layout).
```

### Photo handling

```
Capture: <input type="file" accept="image/*" capture="environment">  ← existing pattern
Queue:   File object stored as-is in IndexedDB (structured clone supports File/Blob)
Replay:  new File([blob], fileName, {type}) → append to FormData → server action
Server:  existing submitChecklist reads photo via photoFile.arrayBuffer() — unchanged
```

Server-side `submitChecklist` unchanged. Reconstructed FormData is identical → full reuse of existing logic (incident auto-create, audit log, photo save).

---

## 5. Error Handling & Testing

### Error handling (data-loss-preventing only)

| Failure point | Handling |
|---|---|
| Submit offline → queue write fail (IndexedDB quota/full) | Catch, toast: "Storage full — cannot save offline. Free space or submit online." Do NOT drop payload. Surface to user. |
| Replay → network fail mid-submission | `attempts++`, status back `pending`, retry next `online` event. If `attempts >= 5` → `failed`, surface in offline-banner for manual retry/delete. |
| Replay → server returns error (validation/auth expired) | `status: "failed"`, store `lastError` + server message. User sees entry in queue UI with reason. Never auto-delete. |
| Replay → partial (entry created, photo interrupted) | Not possible — `submitChecklist` is single server action, atomic per call. All in or none. |
| SW precache install fail | Log, continue without shell cache. App still works online. Non-fatal. |
| Read cache miss + offline | Empty state: "No cached data, connect to load." Honest state, not error. |
| JWT cookie expired during offline | Queue stores payload. Replay hits auth wall → `status: "failed"`, `lastError: "Session expired"`. User logs in online, manual retry from queue UI. |
| Photo Blob corrupted in IDB (rare) | Replay catches, `status: "failed"`, message "Photo unreadable — resubmit audit." |

**Never auto-delete queued audits.** Only user-initiated delete from queue UI. This is the data-loss line.

### Testing — one runnable self-check per non-trivial unit

Ponytail rung: non-trivial logic leaves ONE check. vitest already installed (rung 4: reuse installed dep).

**1. `audit-queue.ts` self-check** (`lib/pwa/audit-queue.test.ts`, vitest + `fake-indexeddb` if not present):
- enqueue stores payload + photo Blob, returns localId
- replay reconstructs FormData with File from Blob (photo integrity)
- attempts cap: 5 failures → status "failed", no further auto-retry
- success deletes entry
- concurrent enqueue (2 same-shift audits) → both stored, both replay

Verify `fake-indexeddb` installed before plan. If not, add devDep (one line) OR thin `idb` mock.

**2. `sw.js` — no unit test, manual checklist:**
SW behavior verified via DevTools Application panel + Lighthouse PWA audit. SW logic is browser-platform; unit-testing fetch handlers requires heavy mocking, not worth phase 1. `ponytail: SW unit tests deferred. Add workbox-test framework if SW routing grows complex.`

**3. Cache staleness (`cache-config.ts`):** trivial constants, no test.

**4. Online status hook:** trivial wrapper, no test.

**5. Replay → server action integration:** existing `submitChecklist` has no test (FormData-heavy). Manual: submit one audit online, kill network, submit offline, restore, verify in grid. One E2E path in spec, not automated phase 1.

### Deliberately NOT tested phase 1
- SW fetch handler routing (manual)
- Badge API (cosmetic, progressive)
- Responsive layout touch (visual, manual)
- Push (out of scope)

---

## 6. UI/UX

### Design system — reuse existing, skill confirms direction

UI-UX-Pro-Max skill recommendations (dark-mode, status colors, dense/scannable, WCAG AAA) align with existing `app/globals.css`. Skill-suggested Playfair/Source Serif + blue accent **overridden, not used**. Reason: existing uses Inter + teal `#5eead4` + mature `--color-ops-*` token set. Imposing new palette/font = large debt, zero value, breaks web↔mobile consistency.

**Tokens used (from existing `app/globals.css`, NO new tokens):**

| Token | Hex | Use |
|---|---|---|
| `--color-ops-bg` | `#0b1120` | app background |
| `--color-ops-surface` | `#111827` | cards, sheets |
| `--color-ops-surface-raised` | `#172033` | bottom nav, sticky bars |
| `--color-ops-border` | `#1e293b` | dividers |
| `--color-ops-muted` | `#94a3b8` | secondary text |
| `--color-ops-text` | `#f8fafc` | primary text |
| `--color-ops-accent` | `#5eead4` | teal, active tab, focus ring |
| `--color-ops-info` | `#3b82f6` | info badges |
| `--color-ops-success` | `#22c55e` | OK status |
| `--color-ops-warning` | `#f59e0b` | Warning status |
| `--color-ops-orange` | `#f97316` | incident Medium |
| `--color-ops-danger` | `#ef4444` | Error status, destructive |
| `--font-body` | `Inter` | all text |

`ponytail: zero new design tokens phase 1. Add mobile-specific override only if existing token breaks on small viewport — none found yet.`

### Color & contrast (WCAG AAA target, dark-only)
- Body text `#f8fafc` on `#0b1120` → ~17:1 (AAA ✓)
- Muted `#94a3b8` on `#0b1120` → ~7:1 (AAA ✓)
- Teal accent `#5eead4` on `#0b1120` → ~12:1 (AAA ✓)
- Status: **not color-only** — always pair icon + label (color-not-only). OK=green✓ `Check`, Warning=amber△ `AlertTriangle`, Error=red✕ `XCircle`. Lucide (existing dep).
- App dark-only. No light mode phase 1 (matches existing web).

### Typography (Inter, existing)
- Base 16px (`text-base`) — prevents iOS zoom-on-focus
- Scale: `text-xs` 12px (badge), `text-sm` 14px (secondary), `text-base` 16px (body), `text-lg` 18px (card title), `text-xl` 20px (screen title)
- Line-height 1.5 body
- Tabular figures for grid/timestamps: `font-variant-numeric: tabular-nums` (prevents layout shift)
- `font-display: swap` for Inter load

### Navigation — bottom tab bar, 5 max
```
┌──────────────────────────────────────┐
│ Audit │ Grid │ SIEM● │ Rack │ Profile│
└──────────────────────────────────────┘
```
- 5 tabs (bottom-nav-limit). Order: staff→admin frequency
- Icon + label (nav-label-icon, no icon-only). Lucide: `ClipboardCheck`, `LayoutGrid`, `ShieldAlert`, `Server`, `User`
- Active: teal accent + label weight 600 + 4px top indicator bar (nav-state-active)
- SIEM badge: red dot when open finding/incident. Clear after visit (tab-badge)
- `role="tablist"`, `aria-current="page"`, arrow-key nav (keyboard-nav)
- Hidden when keyboard active / camera fullscreen via `visualViewport` listener (safe-area-awareness)
- `position: fixed; bottom: 0; padding-bottom: env(safe-area-inset-bottom)` (iOS home indicator)
- Top app bar: minimal — back + screen title + contextual action (overflow). No nav duplication

### Touch & interaction
- Min target 44×44px (touch-target-size, iOS HIG). `min-h-11 min-w-11`
- Touch spacing 8px min (touch-spacing). `gap-2`
- `touch-action: manipulation` (kill 300ms delay)
- `cursor-pointer` web
- Press feedback: `active:scale-95 active:opacity-80` 150ms (press-feedback, scale-feedback)
- Disabled: opacity 0.4 + `cursor-not-allowed` (disabled-states)

### Screen patterns

**Audit checklist form** (single scroll, sticky submit):
```
┌─────────────────────────────────┐
│ ← New Audit        [⋯]         │  top app bar
├─────────────────────────────────┤
│ Date      [2026-08-07]          │
│ Time      [14:32]               │
│ Shift     [Pagi│Siang│Malam]   │  segmented control, 3 buttons
│ Site      DC-JKT-01             │
├─────────────────────────────────┤
│ ▼ Rack A (4 devices)            │  collapsible per-rack
│   ┌─────────────────────────┐   │
│   │ SW-CORE-01   [OK│⚠│✕]   │   │  segmented status, one tap
│   │ Remarks: ___             │   │
│   │ [📷 Photo]               │   │  full-width, large icon
│   └─────────────────────────┘   │
│   ... more devices              │
├─────────────────────────────────┤
│ ⚠ Offline — 2 queued        [×] │  sticky banner (if offline)
├─────────────────────────────────┤
│      [   Submit Audit   ]       │  sticky bottom bar, full-width
└─────────────────────────────────┘
```

**SIEM findings list** (list-first, detail sheet):
```
┌─────────────────────────────────┐
│ SIEM Findings   [filter ⌄]    │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ ● Medium  Failed SSH login  │ │  severity dot + title
│ │ 4 events · 5m ago           │ │  meta + relative time
│ │ sw-core-01                  │ │  source device
│ └─────────────────────────────┘ │
│ ... (virtualize 50+)            │  virtualize-lists
└─────────────────────────────────┘
Tap card → bottom sheet detail (swipe-down dismiss):
  severity, summary, recommended action
  [Ack] [Create Incident] [Close]
```
- Virtualize lists 50+ (virtualize-lists, performance)
- Pull-to-refresh (native PWA feel)
- Relative time + tabular figures (number-tabular)

**Rack mobile** (read-only vertical):
```
┌─────────────────────────────────┐
│ Rack A   ‹ 3/12 ›              │  swipe left/right between racks
├─────────────────────────────────┤
│ U47 │ (empty)                  │
│ ...                             │
│ U20 │ ┌──────────────────────┐ │
│ U19 │ │ SW-CORE-01           │ │  tap → info sheet
│ U18 │ │ 48p · 10G · uptime   │ │
│     │ │ [SSH] [HTTPS] [Web]  │ │  remote access launch
│     │ └──────────────────────┘ │
└─────────────────────────────────┘
```
- Drag-drop OFF mobile (gesture-conflict, precision). Edit stays desktop
- Tap device → bottom sheet: port, IP, status, link launch (HTTP/HTTPS/SSH/Telnet existing)

**Grid 7-day** (horizontal scroll):
```
        Mon  Tue  Wed  Thu  Fri  Sat  Sun
SW-01   ✓   ✓   ⚠   ✓   ✓   ✓   ✓     ← horizontal scroll, sticky first col
SW-02   ✓   ✓   ✓   ✓   ✕   —   —
↑ sticky device name column
```

**Queue UI** (in Profile tab):
```
Pending Audits (2)
┌─────────────────────────────────┐
│ 2026-08-07 Pagi · DC-JKT-01     │
│ status: pending · 3 attempts   │
│              [Retry] [Delete]  │
└─────────────────────────────────┘
failed row: red border, lastError shown
```

### States (every list/screen)
- Loading: skeleton `animate-pulse` (progressive-loading, loading-states). No blank, no spinner-only
- Empty: Lucide icon + text + CTA. e.g. findings empty: "No findings. Active alert? Check syslog sources."
- Error (online fail): "Couldn't load. [Retry]" (error-recovery)
- Cache-stale label: small "cached 5m ago" in header (offline-support)
- Submit feedback: button `disabled={loading}` + spinner (loading-buttons, submit-feedback, prevent double-submit)

### Offline UX
```
┌─────────────────────────────────┐
│ ⚠ Offline — 2 audits queued  ×  │  sticky top, dismissible per session
├─────────────────────────────────┤
│ [page content]                  │
├─────────────────────────────────┤
│ [Audit][Grid][SIEM●][Rack][Profile]│
└─────────────────────────────────┘
```
- Submit offline → toast bottom (auto-dismiss 4s, `aria-live="polite"`): "✓ Saved offline — syncs when back online" (toast-dismiss, toast-accessibility)
- `online` event → toast: "Syncing N audits..." → per-audit: "Synced: 2026-08-07 Pagi"
- Queue `failed` row: red border + `lastError` + retry/delete (error-clarity)
- Never auto-delete queued (data-loss line)

### Forms & feedback
- Visible label per input (input-labels, no placeholder-only)
- Required: asterisk (required-indicators)
- Inline validation on blur, not keystroke (inline-validation)
- Error below field, `role="alert"` + `aria-live` (aria-live-errors)
- Photo input: `<input type="file" accept="image/*" capture="environment">` existing pattern, large tap area
- Multi-step (QR scan → form): back button preserves state (state-preservation)
- Submit button: sticky bottom, full-width, single primary CTA per screen (primary-action)
- Confirm destructive: delete queued audit → `AlertDialog` (confirmation-dialogs)

### Animation (150–300ms, meaningful)
- Tab switch: crossfade 200ms (fade-crossfade)
- Sheet enter: slide-up 250ms ease-out; exit slide-down 180ms ease-in (exit-faster-than-enter, modal-motion)
- Toast: slide-up + fade 200ms, auto-dismiss 4s
- Press: scale 0.95 + opacity 0.8, 150ms (scale-feedback)
- `prefers-reduced-motion`: disable slide/scale, instant crossfade only (reduced-motion)
- No parallax, no decorative animation (motion-meaning, excessive-motion)
- `transform`/`opacity` only, no width/height animate (transform-performance, layout-shift-avoid)

### Accessibility
- Skip link "Skip to content" (skip-links)
- Heading hierarchy h1→h2 sequential (heading-hierarchy)
- Sheets: focus trap, ESC close, `aria-modal="true"` (modal-escape)
- Status segmented: `role="radiogroup"`, items `role="radio"`
- Color + icon + text, never color-only (color-not-only)
- `aria-current="page"` active tab (nav-state-active)
- Focus ring: `box-shadow: 0 0 0 2px rgba(94,234,212,0.2)` existing — do not remove (focus-states)
- Badge count announce via `aria-live="polite"` region
- `alt` for evidence photos: "Evidence photo for SW-CORE-01, 2026-08-07 Pagi" (alt-text)

### Performance
- Virtualize findings/incident lists 50+ (virtualize-lists)
- Lazy load below-fold: rack list, photo thumbnails `loading="lazy"` (lazy-loading)
- Reserve image space `aspect-ratio` prevent CLS (image-dimension)
- Bundle split per route (Next App Router default, bundle-splitting)
- SW precache shell only (critical assets), lazy rest
- Main thread budget: debounce search input 300ms (debounce-throttle)

---

## 7. Dependencies Delta

- **Add runtime:** `idb` (~1KB) — IndexedDB wrapper
- **Add devDep:** `fake-indexeddb` — IF not already present in `package.json` devDeps (plan step: check `package.json`; if absent, add via `npm i -D fake-indexeddb`)
- **No:** next-pwa, Workbox, push libraries, biometric libs

---

## 8. Files Touched Summary

```
NEW:
  public/sw.js
  app/manifest.ts
  lib/pwa/{db,audit-queue,cache-config,register-sw}.ts
  lib/pwa/audit-queue.test.ts
  components/mobile/{bottom-nav,mobile-shell,offline-banner}.tsx
  hooks/use-online-status.ts

TUNE (responsive only):
  app/[locale]/(dashboard)/checklist/page.tsx
  app/[locale]/(dashboard)/grid/page.tsx
  app/[locale]/(dashboard)/admin/siem/findings/page.tsx
  app/[locale]/(dashboard)/admin/incidents/page.tsx
  app/[locale]/(dashboard)/admin/rack/page.tsx
  app/[locale]/layout.tsx (SW register + manifest link, guarded)
```

Backend untouched. No DB migration. No new API routes. No server action changes. No new design tokens.

---

## 9. Deferred (with upgrade triggers)

| Deferred | When to add | Trigger |
|---|---|---|
| Web Push for SIEM alerts | Admin misses real-time alert off-app | on-call complaint + VAPID setup |
| Background Sync | iOS Safari share < 10% + SW replay flaky | monitoring failure rate |
| Dedup constraint `UNIQUE(siteId,checkDate,shift)` | Duplicate offline submissions | support ticket |
| Mobile rack edit / drag-drop | Staff edits rack on tablet | explicit request |
| Separate mobile route group | Breakpoints hit ceiling on a page | UX complaint per-page |
| SW unit tests | SW routing > 4 patterns | complexity signal |
| Light mode | User demand | explicit request |
