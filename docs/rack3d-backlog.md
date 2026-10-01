# 3D Rack View: Improvement Backlog

Captured 2026-10-01. Not scheduled yet; grilling session in progress.

## Requested by user

- Custom room light colour (per location?), with presets.
- Custom wall wallpaper (upload, tiled on the four walls).

## Candidate ideas

### Visual
- Light presets: cool white, warm, blue NOC, red alert.
- Logo / branding on the back wall.
- Alarm mode: room lights pulse red slowly while any device is NOT OK.

### Functional
- Occupancy heatmap: rack colour by used U (green / yellow / red).
- Cable lines between devices from network docs (`connectedToDeviceId`). Heaviest item; own batch.
- Auto tour: camera walks every rack (NOC wall / presentation).
- Screenshot: download the 3D view as PNG for reports.

### From data already in the DB (no new data entry needed)
- Open incidents on the device: badge/beacon above the device, severity colour (`incidents.deviceId`, `severity`, `status`).
- Room temperature: tint or temp label per room from `locations.tempC` vs `tempThresholdC` (manual, set during audits).
- Audit progress: today's OK / NOT OK / Pending per rack ("rack audited 6/7"); last audit date and finding photo in the drawer (`checklistItems.photoPath`).
- SIEM: open findings / recent syslog events per device (`siemFindings`, `syslogEvents.deviceId`).
- Critical devices: highlight `devices.isCritical`.
- Device IP, asset code and PIC group in the drawer (`ipAddress`, `assetCode`, `devicePics`).

### Needs new data or integration
- Live power / humidity / PDU readings: no table, no poller.
- Warranty, purchase date, serial, EOL: no columns.
- Per-switch NCM backup / drift: only via live NCM API or incident titles.
- Kiosk / NOC mode with auto data refresh: does not exist (only the 3D Fullscreen button).

### Data caveats
- No device-to-rack FK: racks match `devices.rackName` by lowercase name.
- NCM incidents fall back to the site's first device when the switch name doesn't match, so they can land on the wrong device in 3D.
- Local demo DB has 0 cable links, 0 open incidents, 0 critical devices, 0 room temperatures; production fill unknown.
- Settings storage: no appearance table. Fits as new columns on `locations` (per room) via the existing floor-plan upload flow (`actions/locations.ts`, `lib/upload.ts`, new `UploadDirectory`).

## Decisions (grilling round 1, 2026-10-01)

- Users: daily audit operators first, then presentations to management/auditors. Not a NOC/TV wall (kiosk mode out of scope).
- Appearance (light colour, brightness, wallpaper) stored per location in the DB, shared by all users. Brightness adjustable.
- Only site admins change appearance.
- Performance floor: office laptop with integrated GPU; new features must stay smooth on Quality Medium, heavy effects High only.
- Do not push the orbit revert alone (main auto-deploys); ship it with the whole batch.
- Production has all data filled: incidents, room temps, cable links, critical devices.
- Critical devices must raise a warning popup.

## Decisions (grilling round 2)

- Critical popup: both. (a) On entering a room, a popup lists critical devices that have a problem (NOT OK today or an open incident); clicking one flies to it. (b) Opening a critical device shows a red warning banner at the top of the drawer.
- Critical marker: quiet outline + warning icon on the label for every critical device; blinking beacon above the rack only while a critical device has a problem.
- Incidents: badge above the device coloured by highest open severity (Low blue, Medium yellow, High orange, Critical red), plus an incident list in the drawer with links.
- Cables: drawn only for the selected device, to every connected peer; peer racks highlighted. Must be tidy (routing to be decided).
- Room temperature: floating label (temp / threshold), red when over threshold. No automatic ambient colour change.
- "Color by" dropdown: Category (default) / Occupancy / Audit status.

## Decisions (grilling round 3)

- Cables routed like a real DC: port, up to the cable tray above the rack, along the tray, down to the peer port. Same-rack links use a short loop in front of the rack. Colour by link type (access / trunk / uplink).
- Cable ends at the exact port when the device has a faceplate config; otherwise at the device front centre.
- Connections listed in the drawer (local port to peer device/port); clicking a row flies to the peer. No hover tooltip on lines.
- Lighting per location: colour + brightness slider (0-200%) + presets (Cool white / Warm / Blue NOC). One setting for both app themes.
- Wallpaper: built-in choices (brick, acoustic panel, concrete) plus custom upload. Built-ins drawn procedurally (canvas textures, like the floor tiles), no image assets.
- In this batch: auto tour, PNG screenshot, extra drawer info. Out: alarm mode.

## Decisions (grilling round 4)

- Built-in wallpapers drawn procedurally (canvas textures). Custom upload has a Tile / Stretch mode.
- Appearance panel lives inside the 3D view (admin-only button): live preview in the scene, then Save to the location.
- Auto tour: flies rack to rack (~5 s each) and loops; racks with a troubled critical device first; overlay shows rack name + summary (devices, OK / NOT OK, incidents). Stops on drag, click or Esc.
- Screenshot: canvas at 2x with a footer (location, site, date-time). HTML labels not included.
- Critical popup: once per room per browser session; afterwards a small "critical" chip in the corner reopens it.

## Done

- 2026-10-01: orbit back to full quality while dragging (regress / half-res DPR removed, it lagged).
