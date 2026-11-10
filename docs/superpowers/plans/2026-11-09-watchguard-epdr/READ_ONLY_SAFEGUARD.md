# WatchGuard read-only safeguard — current binding restriction

User instruction: **do not change anything on the WatchGuard server**. This restriction supersedes earlier dispatch, approval, auto-scan, repair, comment, provider-close and activation plans. Those are future design only, not permission to execute or enable writes. Local dc-check development/Incident records remain in scope.

## Effective mode

`WATCHGUARD_READ_ONLY_LOCK = true`, server-owned and fail-closed. All real provider adapters in this delivery are read-only. No UI checkbox, DB rule, credential privilege, approval, script flag or environment variable may unlock real writes. Separate explicit user authorization and a later reviewed code change are required to implement an unlock path.

Read-only API credentials are recommended as defense in depth. Read-write credentials never override the transport lock. User must configure/rotate credentials in Console themselves; the agent does not alter WatchGuard API access settings.

## Mandatory transport boundary (T01)

Implement a single private authenticated outbound transport guard. Every client, worker, action, provider-sync outbox, CLI helper and integration test path uses this boundary. Validate the final URL and HTTP method **before opening a connection**:

1. Fixed allowed HTTPS region host, standard port, no URL userinfo, fragment or redirect; reject encoded/path-normalization tricks.
2. Permit only explicit documented read operations required by the delivered ticket (GET account details, inventory/protection/licenses, security events, task/status/results, incident/action/comment retrieval). Maintain exact route templates and parameter validation. Unknown GETs fail closed; GET is not inherently proof of non-mutation. Do not proxy arbitrary URLs.
3. Sole POST exception: exact `/oauth/token` on the fixed regional authentication host, form `grant_type=client_credentials`, `scope=api-access`; no business/action payload. Token issuance is the authorized authentication exception, not an endpoint/configuration action.
4. Reject all other POST, PATCH, PUT, DELETE and unlisted methods/paths with typed `WATCHGUARD_READ_ONLY_BLOCKED`, without performing network I/O. This includes status read/closed, comments, transaction batches, isolation, scans, reboot, license/account changes, repair and configuration assignment.
5. No alternate HTTP clients, generic SIEM webhooks, browser automation, private endpoints, external sidecars or shell calls may bypass the guard to mutate WatchGuard. New provider mutations expose blocked adapters, not working real implementations.

Do not ship a transport switch taking `allowWrites: true`. Fake command adapters exist only in tests with injected in-memory/mock transport, never selectable by production config.

## Worker, UI and state effects

- Live ingestion/read-only polling may be implemented but live execution remains operator-controlled; no automatic agent live probes during development. Tests always mock network.
- UI displays persistent **WatchGuard READ-ONLY** badge, effective disabled-action reason and capability state. Hide/disable actual dispatch and WatchGuard status-sync controls with server checks; a hidden button alone is insufficient.
- Rules can be authored and simulated; effective provider execution remains simulation/read-only-blocked. Local approval does not lift the lock or create a live dispatch. Local DC Incident statuses can be updated with truthful local evidence; provider status stays unchanged.
- No scan acceptance, task ID, In Progress, completed scan, repair or provider-close success may be fabricated. Show `simulated` / `blocked_read_only` evaluation reason and preserve actual observed provider status. Existing tasks may be read to observe their real results, not attributed to dc-check execution.
- Provider outbox is non-dispatching while locked. Generated scan/status/comment intentions are inert simulations, not live queued work. Persist read-only suppression provenance and never automatically replay these intentions after any future unlock; new authorization/re-evaluation is required.
- Existing queued requests and scheduled workers never gain permission merely by being approved before the lock. Check the lock at final transport boundary and dispatcher/outbox boundary.
- T07–T10 implement state machines and mock-only command adapters; mark acceptance `done (mock/local)` vs `blocked by read-only policy` explicitly. Production-write acceptance/activation is not done. T11 release checklist has no live scan/migration/activation step automatically authorized.

## Required regression tests

- Actual production client + fake fetch: every mutating method/path (including nested transaction, status, comment, scan, repair, assign, reboot, account/license operations) throws the read-only error and fetch call count stays zero.
- Only exact regional token request gets POST permission. Reject near-match/trailing alternate paths, other host/port, redirects, encoded paths and altered grant/body.
- Allowlisted GET succeeds; unknown GET fails before network. Credentials/tokens stay redacted.
- Worker/outbox/script/server-action/direct adapter, automatic mode, approval and forced client params cannot bypass the lock. Tests prove simulate on server/critical sends nothing too.
- Startup with old queued work does not dispatch; future permission change cannot replay suppressed intentions.
- Mock end-to-end scan logic may complete locally, while the same action through real adapter remains blocked; no environment/config path selects mock transport in production.

## Handoff statement

State explicitly: the safeguard is **documented** until implemented and tested in code; it is not a firewall protecting a separate existing system. Once implemented report exact guard file/test results. No claim of technical protection based only on documentation. Never include real credentials in prompts, code, fixtures or logs.
