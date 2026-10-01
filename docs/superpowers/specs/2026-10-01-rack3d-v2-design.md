# Rack 3D v2: audit signals, cables, appearance, tour

Date: 2026-10-01. Source: grilling session recorded in `docs/rack3d-backlog.md`.

## Goal

Make the 3D rack view the place an operator looks during the daily audit, and
something worth showing to management and auditors. Problems (critical
devices, incidents, failed checks) must be impossible to miss; connections
must be traceable; the room must look like *their* room.

## Users and constraints

- Primary: daily audit operators. Secondary: presentations to management /
  auditors. Not a NOC wall (no kiosk mode, no live data polling).
- Performance floor: office laptop with an integrated GPU. Every feature here
  must stay smooth on Quality Medium; anything heavy is High only.
- Orbit stays full quality while dragging (commit `172cc01` reverted the
  half-res regress that lagged).
- `main` auto-deploys: the whole batch, including the orbit revert, lands in
  one merge after everything is green.

## Scope

In: drawer additions, critical-device marker + popup, incident badges, "Color
by" modes, room temperature label, cable routing for the selected device,
per-location appearance (light colour, brightness, wallpaper), auto tour, PNG
screenshot.

Out: alarm mode (room lights pulsing red), kiosk/NOC mode, live power /
humidity / PDU, warranty / EOL fields, per-switch NCM backup status, hover
tooltips on cables.

## 1. Data (server)

`getRackLayout` (`actions/rack-layout.ts`) already returns racks with devices,
today's status and faceplate ports. It gains, per device:

| Field | Source |
|---|---|
| `isCritical` | `devices.isCritical` |
| `ipAddress`, `assetCode` | `devices` |
| `openIncidents: { count, maxSeverity }` | `incidents` where status in Open / In Progress, grouped by deviceId |
| `ports[].connectedToDeviceId`, `connectedToPortId` | `network_ports` (already loaded for faceplate devices; extended to every racked device that has connected ports) |

Per rack: nothing new (occupancy is computed client-side from `occupiedU` and
`totalU`).

Per location: `getFloorPlans` is replaced by `getRoomSettings`, returning
`Record<locationId, RoomSettings>` with `tempC`, `tempThresholdC`,
`floorPlanPath`, and the appearance fields (§6). Its one caller
(`app/[locale]/(dashboard)/admin/rack/page.tsx`) is updated.

Drawer details are loaded on demand (one server action, like
`getPortsByDevice` today), not in the layout payload:
`getDeviceDrawer(deviceId)` returns PIC groups, last audit item (date, shift,
status, remarks, photoPath), open incidents (id, title, severity, status),
open SIEM findings (count + 3 latest: id, title, severity), and connections
(local port name, peer device id/name, peer port name, mode, VLAN). All
site-scoped through `requireActiveSiteAction`; a foreign device returns null.

Caveat carried over: NCM incidents fall back to the site's first device when
the switch name doesn't match, so a few incidents may badge the wrong device.
Not fixed here.

## 2. Drawer (`components/admin/device-detail-panel.tsx`)

Order, top to bottom:

1. Red "Critical device" banner when `isCritical`.
2. Photo (click to enlarge, already done).
3. Info: Name, Brand, Category, Location, Rack, Position, IP, Asset code, PIC
   group, Status.
4. Last audit: date, shift, status, remarks, finding photo (click to enlarge).
5. Open incidents: severity chip, title, link to the incident.
6. Open SIEM findings: count + 3 latest, link to SIEM.
7. Network docs summary (exists) + connections list; clicking a row selects
   the peer device (3D flies to it; 2D opens its drawer).

Sections with no data collapse to one muted line. The drawer is shared by 2D
and 3D.

## 3. Critical devices and incidents (3D)

- Every critical device: thin amber outline on the faceplate and a warning
  icon on its name tag.
- A critical device "has a problem" when today's status is NOT OK or it has an
  open incident. Then a blinking beacon sits on top of its rack (reuses the
  shared LED blink clock, no extra render loop).
- Incident badge: small floating number above a device with open incidents,
  coloured by the highest severity (Low blue, Medium yellow, High orange,
  Critical red). Drawn as a texture sprite, not `<Html>`, so 50 badges cost
  nothing in DOM.
- Popup: on entering a room that has troubled critical devices, a dialog
  lists them (name, rack, reason); clicking one closes the dialog and flies to
  the device. Shown once per room per browser session (sessionStorage);
  afterwards a "N critical" chip in the scene corner reopens it.

## 4. Color by and temperature

- "Color by" select next to Quality: Category (current behaviour) /
  Occupancy / Audit status.
  - Occupancy colours the whole rack frame by used U / total U: green < 60%,
    yellow 60-85%, red > 85%.
  - Audit status colours device mounting ears and faceplate glow: OK green,
    NOT OK red, Pending grey.
- Room temperature: floating label near the ceiling, "24.5 °C / max 27 °C";
  red when `tempC > tempThresholdC`. Hidden when the room has no reading.
  No automatic change to the room lights.

## 5. Cables

Only for the selected device: one cable per connected port, to the peer's
port.

Routing (pure function, unit-tested, in `components/rack3d/cable-route.ts`):

- Start at the exact port when the device has a faceplate config (port-face
  slot position), otherwise at the device front centre. Same for the end.
- Different racks: out of the port a few cm, up the front of the rack to the
  tray height of that row, along the tray, across rows via the end of the
  rows, down the peer rack front, into the peer port. Right angles with small
  rounded corners; a per-cable lateral offset so parallel cables don't
  overlap.
- Same rack: a short loop in front of the rack between the two ports.
- Peer not placed in the 3D room (other room / unracked): the cable ends at
  the rack top with a small "to <device>" label.

Rendering: one `TubeGeometry` per cable (or a fat `Line2` on Low), colour by
link mode: access blue, trunk orange, uplink (uplink port or peer is a
network device) purple. Peer racks get the focus highlight; peer devices glow.
Max cables = ports of one device (≤ ~52), so no instancing needed.

## 6. Appearance per location

Migration `0062_location_appearance.sql` (hand-written, plus a journal entry;
no drizzle-kit generate, per AGENTS.md):

```sql
ALTER TABLE locations
  ADD COLUMN light_color text,            -- '#rrggbb', null = default
  ADD COLUMN light_brightness real,       -- 0..2, null = 1
  ADD COLUMN wallpaper text,              -- 'none' | 'brick' | 'acoustic' | 'concrete' | 'custom'
  ADD COLUMN wallpaper_path text,         -- /uploads/wallpapers/... when custom
  ADD COLUMN wallpaper_mode text;         -- 'tile' | 'stretch'
```

All nullable, so existing rows keep today's look.

- Server action `updateRoomAppearance(locationId, formData)`:
  `requireActiveSiteAdminAction`, location must belong to the active site,
  zod validation (hex colour, brightness 0..2, enum wallpaper / mode), custom
  upload via `saveUploadFile(..., { kind: "logo", directory: "wallpapers" })`
  with `"wallpapers"` added to `UploadDirectory` / `UPLOAD_DIRECTORIES`, old
  file deleted after the row update (same transaction pattern as the floor
  plan), `logAudit`, revalidate `/admin/rack`.
- Appearance panel inside the 3D view, button visible to site admins only:
  light presets (Cool white `#e6eefc`, Warm `#ffd9a8`, Blue NOC `#7fb2ff`),
  colour picker, brightness slider 0-200%, wallpaper choice + upload + tile /
  stretch. Changes preview live in the scene; Save persists, Cancel restores.
- Scene: the light colour tints the ceiling point lights, the ceiling panels
  and the hemisphere sky colour; brightness scales those intensities. Both app
  themes use the same setting on top of their own base.
- Built-in wallpapers are procedural canvas textures (`textures.ts`, like the
  floor tiles): brick, acoustic panel, concrete. Custom images tile at about
  1 m per repeat, or stretch once per wall.

## 7. Auto tour and screenshot

- Tour button in the 3D toolbar. Visits every rack in the room, racks with a
  troubled critical device first, then layout order, ~5 s each, looping.
  Overlay card: rack name, device count, OK / NOT OK / Pending, open
  incidents. Any drag, click, wheel or Esc stops it. Implemented as a state
  machine driving the existing `focusRack`, so the camera fly-to is reused.
- Screenshot button: renders the canvas at 2x into a PNG with a footer
  (location, site, date-time) and downloads it. Needs
  `preserveDrawingBuffer` only during capture: capture by calling
  `gl.render` then `toDataURL` in the same frame instead of turning the flag
  on permanently. HTML labels are not included.

## Testing

- Pure units, Vitest: cable routing (cross-rack, same rack, other room,
  lateral offsets), occupancy band, critical "has a problem" rule, tour order,
  appearance zod schema.
- Server actions with the existing db mocks: `getDeviceDrawer` site scoping,
  `updateRoomAppearance` admin-only / foreign location / bad input /
  file swap.
- Browser check (playwright-cli) on the dev server: drawer sections, popup +
  chip, badges, cables on Core Switch with seeded links, appearance save,
  tour stop on drag, screenshot download, orbit fps on Medium.
- Gate before merge: `npm run test`, `typecheck`, `lint` on changed files,
  `build`.

## Delivery

One branch (`fix/rack3d-orbit-revert`, renamed to `feat/rack3d-v2`), one
commit per step, merged and pushed once:

1. Data + drawer additions.
2. Critical marker + popup + incident badges.
3. Color by + temperature label.
4. Cables.
5. Appearance (migration reviewed separately before merge).
6. Tour + screenshot.
