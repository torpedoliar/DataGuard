# Phase 06 - Rule Engine and Findings

## Objective

Correlate normalized events into actionable SIEM findings.

## Deliverables

- `scripts/siem-rule-worker.ts`
- rule evaluation helpers
- default rule pack
- finding generation/upsert logic
- finding tests
- `/admin/siem/findings` basic list/detail

## Worker mode

Run every 30-60 seconds.

Flow:
1. Load enabled rules.
2. Query recent normalized events based on rule windows.
3. Group events by rule `group_by` fields.
4. Evaluate threshold/sequence/single-event logic.
5. Upsert finding by `rule_id + correlation_key`.
6. Respect cooldown.
7. Send alert job if enabled and severity qualifies.

## Rule types

### `single_event`

One event creates finding.

Examples:
- device reboot
- config changed
- critical hardware alert

### `threshold`

N events in a time window.

Examples:
- failed login spike
- firewall deny burst
- parser error spike

### `sequence`

Ordered pattern.

Examples:
- failed logins followed by success
- interface down then up repeatedly

### `absence`

Expected event missing.

Examples:
- source silent for 30 minutes

### `baseline_anomaly`

Volume deviation from historical baseline.

Examples:
- sudden log volume spike

## Initial rule pack

Authentication:
1. Failed login spike
2. Successful login after repeated failures
3. Login from unknown IP
4. Admin login outside working hours
5. New username seen

Network:
6. Interface down on critical device
7. Interface flap
8. Trunk/uplink down
9. STP topology change burst
10. DHCP conflict

Firewall:
11. Deny burst from same source
12. Deny burst to critical destination
13. Port scan pattern
14. VPN login failure spike
15. IPS critical signature

System:
16. Device reboot
17. Config changed
18. Config changed outside maintenance window
19. Power supply failure
20. Fan/temp warning
21. Disk full
22. Service crash

SIEM health:
23. Syslog source silent
24. Sudden log volume spike
25. Parser error spike
26. Unknown source sending many events

## Finding severity rules

- Base severity from rule.
- Increase severity if device critical/uplink/core.
- Increase severity if repeated finding within cooldown.
- Critical if brute force followed by successful login.

## Deduplication

Correlation key examples:
- failed login: `device_id:src_ip:username`
- interface flap: `device_id:interface_name`
- firewall deny: `device_id:src_ip:dst_ip:dst_port`
- source silent: `source_id`

## Tests

- threshold rule creates finding at threshold.
- below threshold creates no finding.
- sequence failed-login-then-success creates Critical finding.
- duplicate evaluation updates existing finding, not create duplicate.
- cooldown prevents alert spam.
- source silent rule detects missing logs.

## Acceptance criteria

- Findings are generated from real normalized events.
- Findings have sample event IDs.
- Findings update last seen/event count on repeat.
- No duplicate flood for same correlation key.
