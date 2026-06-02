# SIEM Syslog Implementation Plan

Goal: add full SIEM capability to DC Check using syslog input on UDP 514, with raw storage, parsing, normalization, enrichment, rule correlation, human-readable analysis, alerting, and incident integration.

## Phase order

1. [Phase 01 - Core Schema](./phase-01-core-schema.md)
2. [Phase 02 - Syslog Receiver UDP 514](./phase-02-syslog-receiver.md)
3. [Phase 03 - Parser and Normalization Engine](./phase-03-parser-normalization.md)
4. [Phase 04 - Source Mapping and Asset Enrichment](./phase-04-source-enrichment.md)
5. [Phase 05 - SIEM Event Explorer UI](./phase-05-event-explorer.md)
6. [Phase 06 - Rule Engine and Findings](./phase-06-rule-engine-findings.md)
7. [Phase 07 - Human-Readable Analysis](./phase-07-human-analysis.md)
8. [Phase 08 - Dashboard, Alerting, and Incident Integration](./phase-08-dashboard-alert-incident.md)
9. [Phase 09 - Retention, Performance, and Security Hardening](./phase-09-retention-performance-security.md)
10. [Phase 10 - AI-Assisted Analysis](./phase-10-ai-analysis.md)

## Non-negotiable design choices

- Device-facing syslog receiver uses UDP 514.
- Receiver is a separate long-running worker, not a Next.js route.
- Raw syslog is immutable and stored separately from parsed events.
- Parsing, normalization, enrichment, and rule analysis are separate layers.
- Rule-based human analysis ships before AI-assisted analysis.
- SIEM admin settings and rule editing are admin-only.
- Raw log rendering must be escaped/sanitized.
- Secrets in logs must be redacted before alerting or AI analysis.

## Recommended implementation style

- Build phase by phase.
- Each phase has tests before production code.
- Keep receiver fast: accept packet, queue/batch DB write, parse async when possible.
- Avoid AI or heavy rule work inside UDP packet receive path.
- Keep all generated findings traceable to sample event IDs.
