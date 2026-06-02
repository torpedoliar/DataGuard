# Phase 01 - Core SIEM Schema

## Objective

Create database foundation for SIEM data: raw syslog, normalized events, source mapping, rules, findings, alerts, and settings.

## Deliverables

- Drizzle schema additions.
- Migration files.
- Seed default SIEM rules/settings if needed.
- Unit tests for enum/value helpers and schema-dependent parser types where applicable.

## Tables

### `syslog_sources`

Purpose: known syslog senders and mapping to DC Check assets.

Fields:
- `id`
- `site_id`
- `device_id` nullable
- `source_ip`
- `hostname` nullable
- `display_name`
- `vendor` default `generic`
- `product` nullable
- `parser_profile` default `generic`
- `trust_level` default `unknown`
- `enabled` default true
- `last_seen_at` nullable
- `event_count` default 0
- `created_at`
- `updated_at`

Indexes:
- `(site_id, source_ip)`
- `(source_ip)`
- `(hostname)`
- `(device_id)`
- `(enabled)`

### `syslog_events_raw`

Purpose: immutable forensic copy of received log.

Fields:
- `id`
- `received_at`
- `source_ip`
- `source_port`
- `transport`: `udp`, `tcp`, `tls`
- `raw_message`
- `raw_size`
- `ingest_status`: `received`, `parsed`, `parse_failed`, `dropped`
- `parse_error` nullable
- `created_at`

Indexes:
- `(received_at)`
- `(source_ip, received_at)`
- `(ingest_status, received_at)`

### `syslog_events`

Purpose: parsed, normalized, enriched SIEM event.

Fields:
- `id`
- `raw_event_id`
- `event_time` nullable
- `received_at`
- `source_ip`
- `hostname` nullable
- `facility` nullable
- `severity` nullable
- `priority` nullable
- `app_name` nullable
- `program` nullable
- `process_id` nullable
- `message`
- `site_id` nullable
- `device_id` nullable
- `source_id` nullable
- `vendor` nullable
- `parser`
- `category` nullable
- `normalized_type` nullable
- `action` nullable
- `outcome` nullable
- `src_ip` nullable
- `src_port` nullable
- `dst_ip` nullable
- `dst_port` nullable
- `username` nullable
- `interface_name` nullable
- `protocol` nullable
- `tags` JSON
- `metadata` JSON
- `created_at`

Indexes:
- `(received_at)`
- `(site_id, received_at)`
- `(device_id, received_at)`
- `(source_ip, received_at)`
- `(normalized_type, received_at)`
- `(severity, received_at)`
- `(category, received_at)`

### `siem_rules`

Purpose: configurable detection rules.

Fields:
- `id`
- `name`
- `description`
- `enabled`
- `severity`: `Low`, `Medium`, `High`, `Critical`
- `category`
- `rule_type`: `single_event`, `threshold`, `sequence`, `absence`, `baseline_anomaly`
- `conditions` JSON
- `group_by` JSON
- `threshold` nullable
- `window_seconds` nullable
- `cooldown_seconds` default 300
- `alert_enabled` default false
- `created_at`
- `updated_at`

Indexes:
- `(enabled)`
- `(category)`
- `(severity)`

### `siem_findings`

Purpose: correlated security/ops findings.

Fields:
- `id`
- `site_id` nullable
- `device_id` nullable
- `source_id` nullable
- `rule_id` nullable
- `title`
- `summary`
- `human_analysis` nullable
- `recommended_action` nullable
- `severity`
- `status`: `Open`, `Acknowledged`, `Resolved`
- `event_count`
- `first_seen_at`
- `last_seen_at`
- `sample_event_ids` JSON
- `correlation_key`
- `acknowledged_by` nullable
- `acknowledged_at` nullable
- `resolved_by` nullable
- `resolved_at` nullable
- `created_incident_id` nullable
- `created_at`
- `updated_at`

Indexes:
- `(status, severity, last_seen_at)`
- `(site_id, status, severity)`
- `(device_id, status)`
- `(rule_id, correlation_key)` unique if practical

### `siem_alerts`

Purpose: alert delivery audit.

Fields:
- `id`
- `finding_id`
- `channel`: `telegram`, `email`, `webhook`
- `recipient` nullable
- `status`: `pending`, `sent`, `failed`
- `message`
- `sent_at` nullable
- `error` nullable
- `created_at`

Indexes:
- `(finding_id)`
- `(status, created_at)`

### `siem_settings`

Purpose: global SIEM config.

Fields:
- `id`
- `udp_port` default 514
- `tcp_enabled` default false
- `tcp_port` default 514
- `tls_enabled` default false
- `tls_port` default 6514
- `max_message_size` default 16384
- `raw_retention_days` default 90
- `event_retention_days` default 180
- `finding_retention_days` default 365
- `alert_min_severity` default `High`
- `unknown_source_enabled` default true
- `created_at`
- `updated_at`

## Default rule pack seed

Seed disabled/enabled defaults:
- Failed login spike
- Successful login after repeated failures
- Interface down on critical device
- Interface flap
- Device reboot
- Config changed
- Firewall deny burst
- Syslog source silent
- Unknown source high volume
- Parser error spike

## Tests

- Schema exports compile.
- Rule seed contains expected keys.
- Severity/status enum helpers accept valid values and reject invalid values.

## Acceptance criteria

- `rtk npx tsc --noEmit` passes.
- Migration applies to empty database.
- Existing tests pass.
- No current app behavior changes before receiver exists.
