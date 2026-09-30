# Rack Layout 3D View — Design

Date: 2026-09-30
Status: Draft — awaiting review

## Goal

Add a realistic, interactive 3D view to the Rack Layout page (`/admin/rack`) so that:

- **(B) Daily work:** technicians find devices, see free U space, and inspect device details faster than in the 2D grid.
- **(C) Physical orientation:** anyone can see where each rack physically sits in the room.

The 3D view must look as realistic as practical (procedural, photoreal-leaning), and must still work when no floor plan is uploaded and no rack positions are set.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Rack placement model | Grid: `floor_row` + `floor_slot` + `facing` per rack |
| Floor plan | Optional image upload per location, used as floor texture |
| Engine | `three` + `@react-three/fiber` + `@react-three/drei` + `@react-three/postprocessing` |
| Models | Procedural geometry (no `.glb` files) |
| 2D view | Kept as default; drag-drop stays 2D-only |
| Target hardware | Office laptops (iGPU) and NOC PCs (discrete GPU); auto quality preset |

## Out of scope

Free-form floor-plan editor, scanned/`.glb` device models, 3D temperature heatmap, VR, editing devices from 3D, drag-drop in 3D.

---

## 1. Data & input

### Migration `drizzle/0061_rack_3d_layout.sql` (hand-written + `meta/_journal.json` entry)

```sql
ALTER TABLE racks ADD COLUMN floor_row text;
ALTER TABLE racks ADD COLUMN floor_slot integer;
ALTER TABLE racks ADD COLUMN facing text DEFAULT 'front';
ALTER TABLE locations ADD COLUMN floor_plan_path text;
```

- All nullable; existing racks remain valid.
- No unique `(location, row, slot)` constraint — collisions are shown as a UI warning, not a save blocker.
- `facing` accepted values: `'front' | 'back'` (validated in the action, not a DB enum).
- Mirror columns in `db/schema.ts` (`floorRow`, `floorSlot`, `facing`, `floorPlanPath`).

### Actions

- `actions/rack-management.ts` — `addRack` / `updateRack` read and validate `floorRow` (trimmed, uppercased, ≤ 4 chars, empty → null), `floorSlot` (positive int or null), `facing`.
- `actions/rack-layout.ts` — `RackData` gains `floorRow`, `floorSlot`, `facing`, `locationId`. New `getFloorPlans()` returns `{ locationId, floorPlanPath }[]` for the active site.
- `actions/locations.ts` — `updateLocation` accepts an optional floor-plan file (PNG/JPG, via existing `validateUpload` + `saveUploadFile(file, …, { directory: "floorplans" })`) and a "remove floor plan" flag (`deleteUploadFile`). Replacing a plan deletes the old file.

### Forms

- `components/admin/add-rack-form.tsx`, `edit-rack-form.tsx` — fields: Row (text), Slot (number), Facing (select Front/Back).
- `components/admin/edit-location-modal.tsx` — floor plan upload with preview + remove button.

### Placement fallback rules (pure function, see §2 `layout.ts`)

1. No rack in the location has `floor_row` → all racks auto-arranged in one row, sorted by name.
2. Some racks placed → unplaced racks go in an extra row labelled "Unplaced" behind the last row.
3. Two racks with the same row+slot → second is shifted to the next free slot in that row and flagged `collision: true` (warning badge in 3D label + 2D header).

---

## 2. Components & scene

### Files (`components/rack3d/`)

| File | Purpose |
|---|---|
| `rack-view-toggle.tsx` | 2D/3D switch; remembers choice in `localStorage` (try/catch) |
| `rack-scene.tsx` | Loaded via `next/dynamic({ ssr: false })`. `<Canvas>`, lights, environment, camera controller, postprocessing, quality preset |
| `room.tsx` | Floor (raised tiles or floor-plan texture), walls, ceiling panels, cable trays |
| `rack-cabinet.tsx` | Frame, 19" rails with square holes + U numbers, perforated front door (animated), side panels, roof, blanking panels |
| `rack-device.tsx` | Device chassis + faceplate by category, brand decal, status LED |
| `faceplates.tsx` | Category faceplate builders (server / network / storage / power / default) using instanced ports, bays, LEDs |
| `textures.ts` | Procedural canvas textures (perforation, grille, rail holes, floor tile) generated once and cached |
| `camera-rig.tsx` | Intro animation, fly-to rack/device, back-to-room |
| `layout.ts` | Pure: racks → world positions/rotations, fallback rules, bounding box |
| `free-slots.ts` | Pure: devices + totalU → free U ranges |

Dependencies added: `three`, `@types/three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`. Loaded only when 3D is opened.

### Physical scale (1 unit = 1 m)

- 1U = 0.04445 m. Rack outer: 0.6 W × 1.07 D × (totalU × 0.04445 + 0.13) H (42U ≈ 2.0 m).
- Slot pitch within a row: 0.6 m. Row pitch: 1.07 m depth + 1.2 m aisle.
- `facing: 'back'` rotates the rack 180° about Y → hot/cold aisles emerge from data.
- Floor-plan texture spans the racks' bounding box + 1 m margin (aspect preserved, letterboxed).

### Realism

**Cabinet:** matte black powder-coat (roughness ~0.6, slight metalness), hex-perforated front door (alpha-mapped, device faces visible through it; swings open on rack focus), solid side panels, cable-entry roof, blanking panels in empty U.

**Device faceplates** (category matched with the same keywords as `renderCategoryIcon`):

- Server: 2.5" drive bays with activity LEDs, vent grille, power button, name label.
- Network: RJ45 port rows with link LEDs (green/amber, random blink), SFP cages.
- Storage/NAS: 3.5" disk trays with blue LEDs.
- UPS/Power: glowing small LCD + large grille.
- Default: plain vented panel.
- Category color = thin bezel accent (not whole-face fill). Brand logo = decal (loaded from existing `brandLogo` path, same origin).
- Status LED on every device: OK green, Pending amber, NOT OK red pulsing.

**Room:** raised floor (perforated tiles in cold aisles, solid elsewhere, subtle reflection), ceiling LED panels, yellow overhead cable trays above rows, neutral walls. Floor plan replaces the tile floor when uploaded.

**Rendering:** local CC0 HDRI in `public/hdri/` (≤ 2 MB, no CDN — intranet-safe), ACES tone mapping, soft shadows, SSAO, subtle bloom on LEDs/LCDs, light vignette.

### Quality presets

| Preset | Shadows | SSAO | Bloom | DPR |
|---|---|---|---|---|
| High | soft (accumulative) | on | on | up to 2 |
| Medium | basic shadow map | off | on | up to 1.5 |
| Low | none | off | off | 1 |

- Default **Auto**: start High on GPUs detected as discrete tier, Medium otherwise; drei `PerformanceMonitor` steps down on sustained low FPS.
- Manual override (Auto/High/Medium/Low) in the 3D toolbar, remembered in `localStorage`.
- `frameloop="demand"`; only blinking LEDs/animations invalidate frames. Blinking pauses when the tab is hidden.
- No WebGL → message + automatic fallback to 2D.

---

## 3. Interaction

### Shared with 2D (refactor, not duplication)

Extract from `components/admin/rack-layout.tsx` (521 lines):

- `rack-filter-bar.tsx` — search + category/zone filters.
- `device-detail-panel.tsx` — device detail side panel.

Filter state and `selectedDevice` lift into a parent (`rack-layout-shell.tsx`) that renders the toolbar, detail panel, and either the 2D grid or the 3D scene. Filters persist across view switches. Muting logic (`isMuted`) is one shared function.

### 3D controls

- **Location tabs** above the canvas; one room per scene.
- **Hover device:** outline + pointer + tooltip (name, `U{pos}`, `{uHeight}U`).
- **Click rack:** camera flies to the rack front, door opens, other racks fade to 20%. `Esc` / "Back to room" returns.
- **Click device:** device slides out 0.3 m on its rails, detail panel opens.
- **Search/filter:** matches stay lit, others dim. Exactly one match → auto fly-to.
- **Show free U** toggle: blanking panels replaced with translucent green ghost boxes labelled "6U free".
- **Focus rack** dropdown = click rack (works even when no positions are set).
- **Touch:** one-finger orbit, pinch zoom, tap = click.
- Camera orbit limited (no going under the floor or through the ceiling).

---

## 4. Testing & verification

- `components/rack3d/layout.test.ts` — grid placement, `back` rotation, auto-arrange fallback, "Unplaced" row, collision shift + flag, bounding box.
- `components/rack3d/free-slots.test.ts` — free U ranges (empty rack, full rack, multi-U devices, overlapping bad data).
- `actions/rack-management` tests — new fields parse/validate (row normalisation, slot int, invalid facing rejected).
- `actions/locations` test — floor plan replace deletes old file; remove flag clears path.
- WebGL scene: manual verification in browser via Playwright screenshots (room view, rack focus, device pulled out, free-U mode, Low preset).
- Handoff gate: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run build` all green.

## Risks

- **Bundle size:** ~250–300 KB gzip for three/r3f/drei/postprocessing — mitigated by dynamic import only on 3D toggle.
- **iGPU performance:** SSAO + soft shadows are the heavy parts; Auto preset disables them on weaker GPUs.
- **Brand logos:** some are wide/low-contrast; decals are clamped to a max size and placed on a dark label strip.
