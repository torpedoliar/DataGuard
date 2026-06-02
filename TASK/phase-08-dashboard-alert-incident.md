# Phase 08 - Dashboard, Alerting, and Incident Integration

## Objective

Provide SIEM overview, alert delivery, and conversion from finding to incident.

## Deliverables

- `/admin/siem` dashboard
- `/admin/siem/findings` full workflow
- Telegram alert integration
- alert audit table usage
- create incident from finding action

## Dashboard cards

- Events last 24h
- Open Critical findings
- Open High findings
- Unknown sources
- Top noisy devices
- Top event types
- Parser errors
- Silent sources

## Charts

- event volume timeline
- severity distribution
- category distribution
- top source IPs
- top devices
- finding trend

## Finding workflow

Statuses:
- Open
- Acknowledged
- Resolved

Actions:
- acknowledge
- resolve
- reopen
- send Telegram
- create incident
- generate AI analysis later

## Telegram alert policy

Default:
- Critical: immediate
- High: immediate if rule alert enabled
- Medium: optional digest later
- Low: dashboard only

Message template:

```text
[SIEM {severity}] {title}

Site: {siteName}
Device: {deviceName}
Source: {sourceIp}
Events: {eventCount}

Analisa:
{humanAnalysis}

Action:
{recommendedAction}
```

## Alert audit

Every delivery writes `siem_alerts`:
- pending before send
- sent on success
- failed with error on failure

## Incident integration

Create incident from finding:
- title = finding title
- severity mapped to incident severity
- device linked if available
- description includes summary + human analysis + sample event IDs
- remarks includes recommended action
- finding stores `created_incident_id`

## Tests

- Critical finding triggers Telegram when configured.
- Failed Telegram send writes failed alert row.
- Create incident action copies evidence and links finding.
- Acknowledge/resolve require allowed user.

## Acceptance criteria

- Dashboard shows SIEM health at glance.
- High/Critical findings can notify Telegram.
- Finding can become incident with evidence preserved.
