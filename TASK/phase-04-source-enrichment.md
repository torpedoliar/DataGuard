# Phase 04 - Source Mapping and Asset Enrichment

## Objective

Map syslog events to DC Check sites/devices and enrich events with asset metadata.

## Deliverables

- source matching helper
- enrichment helper
- unknown source detection
- `/admin/siem/sources` source management UI
- tests for matching priority and metadata output

## Matching priority

1. `syslog_sources.source_ip`
2. `devices.ip_address`
3. `syslog_sources.hostname`
4. `devices.name`
5. unknown source

## Enrichment metadata

Add to event metadata:
- site name/code
- device name
- asset code
- category
- brand
- location
- rack
- rack position
- zone
- criticality if available

Also set direct columns:
- `site_id`
- `device_id`
- `source_id`
- `vendor`

## Unknown source behavior

When source IP does not map:
- create or update unknown `syslog_sources` record if enabled.
- increment event count.
- update last seen.
- vendor remains `generic`.
- device remains null.

## Source management UI

Route:
- `/admin/siem/sources`

Tabs:
- Known Sources
- Unknown Sources
- Disabled Sources

Columns:
- source IP
- hostname
- mapped device
- site
- vendor
- parser profile
- last seen
- event count
- enabled

Actions:
- map to device
- set vendor/parser
- rename display name
- disable source
- merge duplicate source

## Admin rules

- Source edit admin-only.
- Event viewing can follow existing admin/network permissions later.

## Tests

- exact `syslog_sources.source_ip` beats device IP.
- device IP match works when no source mapping exists.
- hostname match works.
- unknown source is created only when setting enabled.
- metadata includes device/site fields.

## Acceptance criteria

- Syslog from known device appears linked to asset.
- Unknown source appears in UI for mapping.
- Mapping source retroactively affects new events.
