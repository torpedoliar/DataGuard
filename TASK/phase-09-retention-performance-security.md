# Phase 09 - Retention, Performance, and Security Hardening

## Objective

Make SIEM safe for long-running production use under high log volume.

## Deliverables

- retention cleanup worker
- indexes verified
- rate limit/blocklist controls
- secret redaction helper
- UI sanitization checks
- performance tests where practical

## Retention defaults

- raw logs: 90 days
- normalized events: 180 days
- findings: 365 days
- alert audit: 365 days
- aggregate metrics: 2 years later

## Cleanup worker

File:
- `scripts/siem-retention-worker.ts`

Script:
```json
"siem:retention": "tsx scripts/siem-retention-worker.ts"
```

Behavior:
- runs daily or on schedule
- deletes old raw/events/alerts by settings
- never deletes open findings
- logs deleted counts

## Performance

Required indexes:
- `syslog_events_raw(received_at)`
- `syslog_events_raw(source_ip, received_at)`
- `syslog_events(received_at)`
- `syslog_events(site_id, received_at)`
- `syslog_events(device_id, received_at)`
- `syslog_events(source_ip, received_at)`
- `syslog_events(normalized_type, received_at)`
- `syslog_events(severity, received_at)`
- `siem_findings(status, severity, last_seen_at)`

Future partitioning:
- monthly partitions for raw/events if event volume grows high.

## Receiver protection

- max message size
- bounded queue
- rate limit per source IP
- optional allowlist CIDR
- optional blocklist IP
- parser timeout/failure guard

## Redaction

Redact before alerting or AI:
- password
- token
- secret
- API key
- authorization header
- private key fragments
- session cookies

## UI security

- Raw logs render as text only.
- Never use raw log with `dangerouslySetInnerHTML`.
- Escape snippets in tables/details.
- JSON metadata shown in safe preformatted text.

## Tests

- redaction masks known secret patterns.
- retention worker skips open findings.
- rate limiter drops over-limit source.
- raw HTML-like syslog is displayed escaped.

## Acceptance criteria

- SIEM can run continuously without unbounded DB growth.
- Log bursts do not crash receiver.
- Sensitive values are not sent in alerts/AI prompts.
