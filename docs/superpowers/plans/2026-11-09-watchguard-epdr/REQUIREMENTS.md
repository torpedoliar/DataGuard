# Request coverage and handoff acceptance

Read with README and CONTRACTS before implementation. This is a traceability record, not a claim that code exists. All tickets are unimplemented.

## Latest restriction

R14 supersedes all earlier real provider actions: **no changes on WatchGuard server**. [READ_ONLY_SAFEGUARD.md](READ_ONLY_SAFEGUARD.md) is binding. Prior scan/repair/status-sync/close workflows stay future design and mock/local-only. Documenting this requirement does not mean a code-level guard already exists.

## Explicit user requirements

| ID | User request | Owner / acceptance |
|---|---|---|
| R01 | Connect dc-check to WatchGuard for EPDR management and response | T01–T03, T07–T10: authenticated typed client, monitoring, gated commands |
| R02 | Start with one account; each site eventually has its own account | T02: one current connection per site; duplicate region/account binding rejected; pilot first, then additional sites |
| R03 | All operational configuration through UI, per site | T02, T05, T06, T08–T11; CONTRACTS settings inventory is exhaustive; deployment bootstrap is the only non-UI setup |
| R04 | Choose automatic or approval per rule/action | T06–T08: independent execution and closure modes, versioned settings, effective-policy preview; simulation never sends writes |
| R05 | Servers, critical assets, unresolved endpoints require protection | T06–T10: servers/critical require approval; unresolved identity blocks dispatch; optional asset link is not unresolved identity |
| R06 | ThreatSync incidents: IOA, Malware, PUP, Virus, Exploit, rating 7–10 trigger scan | T05–T08: separate scored-incident template; all five normalized categories; score 7 AND <=10; unknown category/score reviewed, never invented |
| R07 | Endpoint Security Malware/PUP/Exploit activity creates DC Incident and FULL SYSTEM scan | T05–T08: independent activity template with no fabricated score requirement; scan_scope=0, endpoint-specific command and dedup |
| R08 | In Progress while processing; close automatically after handling | T07–T08: DC In Progress after provider acceptance; WatchGuard read/comment (no incident inProgress enum); auto-close requires validated clean scan evidence, fresh observation and policy approval |
| R09 | Integrate existing DC Incident, not a second ticketing system | T04–T05: source-linked native incidents, existing assignment/SLA/history, endpoint target and all legacy device paths tested |
| R10 | Endpoints do NOT need registration as assets | T03–T05: optional asset relation; standalone endpoint criticality; no bulk asset/checklist creation |
| R11 | Protection with errors, install error, installing, disabled -> repair protection, then repair agent if still failing | T09: retain exact desired sequence. **BLOCKED for automatic repair**: public OpenAPI 1.5.2 provides status/error fields, no repair commands. UI must label unsupported, offer explicit manual handoff, never silently substitute reboot/uninstall/browser automation |
| R12 | Structured plan executable by another agent | README + CONTRACTS + T01–T11: dependencies, owner, migrations, tests, completion evidence, stop conditions |
| R13 | Record decisions and all new suggestions | Spec plus this matrix. Original requests, engineering recommendations, and unavailable capabilities remain distinguishable |
| R14 | Do not change anything on WatchGuard server | READ_ONLY_SAFEGUARD + T01 transport allowlist and zero-network mutation-block tests; all tickets honor real-provider read-only, mock-only writes, no UI/config unlock |

## Clarifications preserved

- R06 and R07 are two entry paths, not one combined score filter. Malware/PUP/Exploit activity can lack ThreatSync scores; it still enters the activity workflow. ThreatSync categories are normalized from explicit vendor evidence (AV != Virus by default, unknown program != PUP).
- Full system scan is the requested default. Critical-area-first scanning was an earlier suggestion, superseded for these detection templates; optional operator-created scan types must be named clearly.
- Auto-close after task completion is refined to auto-close after successful, adequately evidenced handling. A clean disk scan alone does not clear IOA/Exploit. Default templates keep these and Critical incidents for review; risk-category closure policy is configurable under a global ceiling, not hard-coded to ignore the UI.
- No asset link is required. Unknown target identity is still blocked; server/critical classification must be known before automatic dispatch.
- A user approval of documents is not permission to activate production rules, migrate production DB, restart endpoints, or send live scans.

## Recommended enhancements (not new explicit requirements)

| Enhancement discussed | Disposition |
|---|---|
| Reopen recurrence, cooldown, hold/takeover, circuit breaker, false-positive expiry | T05–T08 |
| Account-wide blast-radius warnings, unisolate/unblock reversals | T10 |
| Software/patch/BIOS/risk reporting, installer links | Capability catalog, not required for core scan/repair workflow; separately authorize expansion |
| MTTA/MTTR, false-positive/recurrence metrics, per-site compliance evidence | T11. Optional daily checklist attachment only for already linked assets; no fake checklist rows for endpoints |
| Repair through a different officially supported management connector | Future evaluation only, authorization and contract required; remains blocked in this release |

## Final acceptance scenarios

Implementation handoff must demonstrate with mocked provider and isolated DB:

1. Two sites with different accounts cannot see/act on each other's endpoints, incidents, credentials or approvals.
2. Endpoint without an asset: new scored IOA/Malware/PUP/Virus/Exploit 7–10 is handled by the scored template; server/critical still needs approval.
3. Activity Malware/PUP/Exploit without a score creates a native endpoint-targeted incident and full scan proposal once; polling and cross-source duplicates create neither duplicate incidents nor scans.
4. Existing task, provider incident containing multiple entities, unmatched entity, delayed results, outage/backfill, partial pagination and new occurrence during scan all prevent premature close.
5. Online protection/install error/disabled follows health diagnosis; installing receives grace period and never an invented error mapping; repair protection/agent are visibly unsupported/manual.
6. All settings in CONTRACTS have UI, server validation, authorization, tests and audit. Empty secret preserves; explicit rotation/clear is separate.
7. Kill switch, hold, revoked role, account/credential change, stale/incomplete data, unknown status and circuit breaker stop new dispatch and automation closure as defined.
8. Crash after dispatch, ambiguous HTTP 5xx, and duplicate worker cannot blindly repeat a scan; ambiguous result goes to review.
9. Successful clean scan plus verified coverage and observation resolves DC Incident; WatchGuard close synchronizes separately and only after all its relevant entities qualify. IOA/Exploit defaults require review.
10. Full `test`, `lint`, `typecheck`, isolated forward migration and build are reported. Live write verification remains separately authorized, initially disabled.
