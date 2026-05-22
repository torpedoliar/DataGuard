# SIEM Syslog Phase 1-10 Design

## Goal

Add full SIEM capability to DC Check using syslog input on UDP 514, with raw storage, parsing, normalization, enrichment, rule correlation, human-readable analysis, alerting, incident integration, retention, security hardening, and optional AI-assisted analysis.

## Scope decisions

- Implement all TASK phases 1-10 in full scope.
- Use a service-heavy split for receiver, parser, rule evaluation, and retention workers.
- Support UDP 514 in both Docker/Linux production and Windows local runtime.
- Optimize for low volume first: under 100 events per minute.
- Keep all SIEM UI and SIEM actions admin-only.
- Seed and support all 26 default rules from Phase 06.
- Unknown syslog sources are assigned to the configured default SIEM site.
- Incident creation from findings is blocked until the finding has a mapped device.
- AI analysis uses manual OpenAI-compatible configuration for 9router-style endpoints, with environment values overriding database settings.
- Raw syslog is always rendered as escaped text. No raw HTML execution mode is allowed.

## Architecture

DC Check remains the UI and workflow application. SIEM ingestion and processing run as separate long-running services:

1. `syslog-receiver` receives UDP packets and writes immutable raw rows.
2. `siem-parser-worker` polls raw rows, parses, normalizes, enriches, and writes normalized events.
3. `siem-rule-worker` evaluates enabled rules, upserts findings, writes alert audit rows, and sends Telegram notifications when policy allows.
4. `siem-retention-worker` removes expired data based on retention settings.
5. Next.js server actions handle admin UI operations, source mapping, rule editing, finding workflow, incident creation, manual Telegram sends, and on-demand AI analysis.

The services communicate through Postgres tables and status fields. No external queue is required in the first implementation because the target volume is low, but the receiver still uses bounded in-memory queueing and batch inserts.

## Data model

Add Drizzle tables and migrations for:

- `syslog_sources`: known or unknown senders, site/device mapping, source IP, hostname, display name, vendor, product, parser profile, trust level, enabled flag, last seen, event count.
- `syslog_events_raw`: immutable packet copy, received time, source IP, source port, transport, raw message, raw size, ingest status, parse error.
- `syslog_events`: parsed, normalized, enriched event with facility/severity/priority, app/program/process fields, site/device/source IDs, vendor/parser, category, normalized type, action/outcome, src/dst fields, username, interface, protocol, tags, metadata.
- `siem_rules`: configurable rule definitions, enabled flag, severity, category, rule type, condition JSON, group-by JSON, threshold, window, cooldown, alert flag.
- `siem_findings`: correlated findings, site/device/source/rule links, title, summary, human analysis, recommended action, severity, status, event count, first/last seen, sample event IDs, correlation key, acknowledgement/resolution fields, incident link, AI analysis JSON, AI generated timestamp.
- `siem_alerts`: finding alert delivery audit, channel, recipient, status, message, sent time, error.
- `siem_settings`: receiver settings, retention settings, default SIEM site, unknown-source setting, alert minimum severity, AI settings.

`siem_settings` includes:

- `default_siem_site_id`
- `udp_port`, `max_message_size`, queue and batching defaults
- `raw_retention_days`, `event_retention_days`, `finding_retention_days`, `alert_retention_days`
- `unknown_source_enabled`
- `alert_min_severity`
- `ai_enabled`
- `ai_endpoint_url`
- `ai_api_key`
- `ai_model_opus`
- `ai_model_sonnet`
- `ai_model_haiku`
- `ai_default_model`
- `ai_max_sample_events`
- `ai_max_raw_length`

Environment variables override database AI settings. This allows local 9router settings such as `http://127.0.0.1:20128/v1`, `sk-...`, and custom model IDs like `kr/claude-opus-4.7`, `cx/gpt-5.5-xhigh`, or `cx/gpt-5.5-xhigh` for different labels.

Raw rows are immutable except for parser-owned `ingest_status` and `parse_error` updates.

## Receiver service

`scripts/syslog-receiver.ts` runs outside Next.js.

Default runtime:

- host: `0.0.0.0`
- UDP port: `514`
- max message size: `16384`
- batch size: `100`
- flush interval: `1000ms`
- bounded queue enabled

Flow:

1. Start UDP socket.
2. Receive packet.
3. Capture remote IP and source port.
4. Validate max size.
5. Decode UTF-8 safely.
6. Push raw event into bounded queue.
7. Batch insert into `syslog_events_raw`.
8. Log counters for received, inserted, dropped, oversized, failed, queue depth.

Backpressure:

- Queue overflow drops according to setting and increments counters.
- Database outage retries with backoff while queue remains bounded.
- Parser and rule logic never run in the UDP receive callback.

Docker Compose adds a `syslog-receiver` service exposing `514:514/udp` and adding `NET_BIND_SERVICE`. Windows runtime also supports direct UDP 514; dev can override port only when needed.

## Parser and normalization

`siem-parser-worker` polls raw events with `ingest_status='received'`.

Parsing supports:

- RFC3164
- RFC5424
- fallback parser that keeps raw message and records parse failure without data loss

PRI decoding uses:

```text
facility = floor(priority / 8)
severity = priority % 8
```

Normalizers:

- generic
- MikroTik
- Cisco
- Fortigate
- Linux

Normalized event contract includes category, normalized type, action, outcome, src/dst IP and port, username, interface, protocol, tags, and metadata.

Processing flow:

1. Claim a batch of raw received events.
2. Parse RFC format or fallback.
3. Pick normalizer from source parser profile/vendor.
4. Run source mapping and asset enrichment.
5. Insert `syslog_events`.
6. Mark raw as `parsed` or `parse_failed`.
7. Track parser errors for dashboard/rules.

## Source mapping and enrichment

Matching priority:

1. `syslog_sources.source_ip`
2. `devices.ip_address`
3. `syslog_sources.hostname`
4. `devices.name`
5. unknown source

Unknown source behavior:

- If enabled, create/update `syslog_sources` using `siem_settings.default_siem_site_id`.
- Increment event count and last seen.
- Use vendor `generic` and no device until mapped.

Enrichment writes direct event columns and metadata:

- `site_id`, `device_id`, `source_id`, `vendor`
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

## Rule engine and findings

`siem-rule-worker` runs every 30-60 seconds.

Supported rule types:

- `single_event`
- `threshold`
- `sequence`
- `absence`
- `baseline_anomaly`

Default rule pack includes all 26 rules from TASK Phase 06:

1. Failed login spike
2. Successful login after repeated failures
3. Login from unknown IP
4. Admin login outside working hours
5. New username seen
6. Interface down on critical device
7. Interface flap
8. Trunk/uplink down
9. STP topology change burst
10. DHCP conflict
11. Deny burst from same source
12. Deny burst to critical destination
13. Port scan pattern
14. VPN login failure spike
15. IPS critical signature
16. Device reboot
17. Config changed
18. Config changed outside maintenance window
19. Power supply failure
20. Fan/temp warning
21. Disk full
22. Service crash
23. Syslog source silent
24. Sudden log volume spike
25. Parser error spike
26. Unknown source sending many events

Finding dedupe uses `rule_id + correlation_key`. Repeated matches update event count, last seen, and sample event IDs instead of flooding duplicate findings.

Severity starts from rule severity and can increase for critical/uplink/core devices, repeated findings, or failed-login-followed-by-success.

## Human-readable analysis

Every finding has rule-based analysis and recommended action before any AI feature.

Structure:

1. What happened
2. Affected asset/site
3. Evidence summary
4. Likely impact
5. Possible causes
6. Recommended actions

Templates cover all default rules and must handle missing optional values without rendering `undefined`.

Finding detail shows:

- first seen
- last seen
- event count
- top source IPs
- top usernames
- affected interface
- sample raw event lines
- links to sample events

## Dashboard, alerts, and incidents

Dashboard cards:

- Events last 24h
- Open Critical findings
- Open High findings
- Unknown sources
- Top noisy devices
- Top event types
- Parser errors
- Silent sources

Charts:

- event volume timeline
- severity distribution
- category distribution
- top source IPs
- top devices
- finding trend

Finding statuses:

- Open
- Acknowledged
- Resolved

Finding actions:

- acknowledge
- resolve
- reopen
- send Telegram
- create incident
- generate AI analysis

Telegram policy:

- Critical: immediate
- High: immediate if rule alert enabled
- Medium: optional/dashboard-first
- Low: dashboard only

Every delivery writes `siem_alerts` as `pending`, then `sent` or `failed`.

Incident creation:

- If finding has `device_id`, create incident from title, severity, summary, human analysis, recommended action, and sample event IDs.
- Link finding to created incident.
- If finding has no device, block creation with a clear message instructing admin to map the source to a device first.

## Admin UI

All SIEM routes and actions are admin-only.

Routes:

- `/admin/siem`: overview dashboard.
- `/admin/siem/events`: event explorer.
- `/admin/siem/sources`: source management.
- `/admin/siem/rules`: rule management.
- `/admin/siem/findings`: finding workflow.
- `/admin/siem/settings`: receiver, retention, default site, alert, and AI settings.

Navigation adds SIEM admin nav and admin landing shortcut.

Event explorer columns:

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

Filters:

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
- injection risk / HTML-like payload

Event detail tabs:

- `Raw`: escaped raw text in preformatted block.
- `Parsed`: parsed and normalized JSON as escaped text.
- `Injection Inspector`: safe HTML/XSS-like payload analysis without execution.

Injection Inspector detects and highlights patterns as text:

- `<script`
- event-handler attributes such as `onerror=` or `onclick=`
- `javascript:` URLs
- `<iframe`
- encoded HTML payloads
- suspicious tag-like payloads

It shows a decoded preview as escaped text and assigns risk `none`, `suspicious`, or `dangerous`. It never uses `dangerouslySetInnerHTML` or browser HTML execution for raw logs.

## Retention, performance, and hardening

Retention defaults:

- raw logs: 90 days
- normalized events: 180 days
- findings: 365 days
- alert audit: 365 days

Cleanup worker:

- runs daily or manually
- deletes old raw/events/alerts by settings
- deletes only closed findings older than retention
- never deletes open findings
- logs deleted counts

Indexes include required received time, source/time, site/time, device/time, normalized type/time, severity/time, category/time, and finding status/severity/last seen indexes.

Receiver protection:

- max message size
- bounded queue
- per-source rate limit
- optional allowlist/blocklist
- parser timeout/failure guard

Redaction before alerting or AI masks:

- password
- token
- secret
- API key
- authorization header
- private key fragments
- session cookies

UI safety:

- raw logs render as text only
- JSON metadata renders as text only
- no raw log path uses `dangerouslySetInnerHTML`
- table previews truncate long messages

## AI-assisted analysis

AI is optional and secondary. Rule-based findings remain the source of truth.

Admin settings support manual OpenAI-compatible configuration:

- endpoint URL, e.g. `http://127.0.0.1:20128/v1`
- API key, e.g. `sk-...`
- model IDs for Opus/Sonnet/Haiku labels
- default model selection
- max sample events
- max raw length per event

Environment variables override database settings so deployments can keep secrets outside DB.

Request adapter:

- POST `{endpoint}/chat/completions`
- body includes `model` and `messages`
- response reads `choices[0].message.content`
- content must parse as JSON matching the required output format

Prompt guardrails:

- use only finding evidence and linked sample events
- redact secrets before prompt
- do not include unrelated logs or database dumps
- instruct model to say evidence is insufficient when weak
- instruct model not to recommend destructive action as first step

Output format:

```json
{
  "summary": "...",
  "impact": "...",
  "likelyCauses": ["..."],
  "recommendedActions": ["..."],
  "confidence": "low|medium|high",
  "evidenceLimits": "..."
}
```

Saved AI analysis remains visible alongside original rule-based analysis and evidence links.

## Tests

Use test-driven development per phase.

Required tests:

- schema exports compile and enum/value helpers validate SIEM values
- 26-rule seed contains expected keys and defaults
- receiver starts with configured host/port
- receiver stores remote IP and source port
- receiver rejects oversized payloads
- receiver batches raw inserts
- receiver does not call parser inline in UDP callback
- RFC3164 parser extracts expected fields
- RFC5424 parser extracts expected fields
- PRI decode maps facility/severity correctly
- fallback parser preserves malformed raw logs
- generic normalizer maps common auth/interface/firewall/system messages
- vendor normalizers cover MikroTik, Cisco, Fortigate, and Linux samples
- source matching priority is correct
- unknown source uses default SIEM site only when enabled
- enrichment metadata includes device/site fields
- event filter query builder combines filters correctly
- text search escapes special input
- pagination is stable by `received_at DESC, id DESC`
- source mapping action requires admin
- each rule family evaluates correctly
- all 26 default rules have evaluation coverage or explicit fixture tests
- duplicate finding evaluation updates existing finding
- cooldown prevents alert spam
- source silent rule detects missing logs
- human analysis templates include core fields and avoid `undefined`
- raw snippets remain escaped in UI components
- Critical/High alert policy writes `siem_alerts`
- failed Telegram send writes failed alert row
- create incident action copies evidence and links finding
- create incident action blocks findings without device
- acknowledge/resolve require allowed admin
- retention worker skips open findings
- rate limiter drops over-limit source
- redaction masks known secret patterns
- AI prompt includes only sample events tied to finding
- AI prompt redacts secrets
- AI response parsing handles OpenAI-compatible response
- Injection Inspector detects HTML-like payloads without executing raw content

## Verification

Before claiming completion:

```bash
rtk npm run test
rtk npx tsc --noEmit
rtk npm run build
```

Manual verification:

1. Run database migrations.
2. Run Next.js app.
3. Run receiver on Windows UDP 514.
4. Send a PowerShell UDP test packet.
5. Confirm raw row appears.
6. Run parser worker and confirm normalized event.
7. Run rule worker and confirm finding from sample data.
8. Inspect `/admin/siem/events` and `/admin/siem/findings`.
9. Confirm raw HTML-like payload displays as escaped text and Injection Inspector flags it.
10. Run Docker Compose receiver and repeat packet test.
11. Configure 9router-style AI endpoint and generate AI analysis from a finding.

## Rollout order

1. Core schema, migrations, settings, and 26-rule seed.
2. Receiver service and Docker/Windows runtime.
3. Parser, normalizers, and parser worker.
4. Source mapping and enrichment.
5. Event explorer UI with Injection Inspector.
6. Rule engine and findings.
7. Human-readable analysis.
8. Dashboard, Telegram alert audit, and incident integration.
9. Retention, receiver protection, redaction, and UI hardening.
10. Optional AI-assisted analysis with manual OpenAI-compatible 9router config.
