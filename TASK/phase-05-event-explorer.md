# Phase 05 - SIEM Event Explorer UI

## Objective

Build UI for searching and inspecting raw and normalized syslog events.

## Deliverables

- `/admin/siem/events`
- event filters
- event detail drawer/page
- raw and parsed tabs
- pagination
- tests for server actions/data loaders where practical

## Event list columns

- received time
- event time
- site
- device
- source IP
- hostname
- severity
- facility
- category
- normalized type
- parser
- message preview

## Filters

- time range
- site
- device
- source IP
- hostname
- severity
- facility
- category
- normalized type
- parser
- text search

## Event detail

Sections:
- Summary
- Raw message
- Parsed syslog fields
- Normalized fields
- Asset enrichment
- Metadata JSON
- Related findings

Actions:
- copy raw event
- copy normalized JSON
- create manual finding
- map source if unknown
- open device detail

## Search behavior

Initial implementation:
- SQL filters with indexed columns.
- Text search on message/raw message with safe escaping.

Later optimization:
- Postgres full-text index if needed.

## Safety

- Raw messages must render as text, never HTML.
- Long messages truncated in table.
- Detail view shows full raw in preformatted escaped block.

## Tests

- filter query builder combines filters correctly.
- search escapes special input.
- pagination stable by `received_at DESC, id DESC`.
- source mapping action requires admin.

## Acceptance criteria

- Admin can inspect incoming syslog events.
- Unknown and parsed events are readable.
- Filters work on common investigation fields.
