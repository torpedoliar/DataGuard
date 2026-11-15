# Public API capability review — no execution authorization

This review records documentation evidence, not permission to enable writes.
The binding READ_ONLY_SAFEGUARD.md remains unchanged. All real provider mutations
must fail before network I/O. Approval, saved rules and local automation cannot
unlock them. No private API, arbitrary URL, command or external webhook is allowed.

## Verified public ThreatSync documentation

Source: https://www.watchguard.com/help/docs/api/Content/en-US/threatsync/v1/threatsync_management.html

Public linked specification (not downloaded/validated in this review):
https://developer.cloud.watchguard.com/catalog-data/threatsync-apis-01/threatsync-apis-01-management-01/threatsync-management/1.2.0/threatsync-management-1.2.0.yaml

The HTML documents creation through POST `/v1/{accountId}/incidents/{incidentId}/actions`
and POST `/v1/{accountId}/actions`, relative to the fixed regional
`/rest/threatsync/management` base. Accepted command names include:

| Local intention | Documented command | Required parameters | Current implementation permission |
|---|---|---|---|
| Kill process | `killProcess` | `pid` or `md5`, endpoint `entityId` | blocked_read_only |
| Quarantine | `quarantineFile` | `md5`, endpoint `entityId` | blocked_read_only |
| Block IP | `blockAddress` | `address` | blocked_read_only |
| Unblock IP | `unblockAddress` | `address` | blocked_read_only |
| Isolate | `isolate` | endpoint `entityId` | blocked_read_only |
| Release isolation | `unIsolate` | endpoint `entityId` | blocked_read_only |

Entity IDs must never be assumed to be Endpoint Security device IDs. Recommended
actions are evidence, not proof of target identity, licensing, eligibility or
successful remediation. Response-only command names such as `deleteFile`,
`blockProcess`, `blockConnection` and `detected` do not establish create support.

PATCH `/v1/{accountId}/incidents/{incidentId}` documents status `new`, `read` or
`closed` with optional `comment`. GET comments/actions are observation only. The
reviewed excerpt does not prove a standalone comment-create route; do not invent
one. Local Incident closure never proves provider closure or remediation.

## Not yet verified

Endpoint Security immediate scan, reboot, configuration assignment and task-result
semantics still require a verified public operation/schema review. Guessed public
HTML paths returned 404 and are not evidence of support or absence. Existing
payload builders are not proof of API capability. Repair remains unsupported
unless exact public documentation proves otherwise.

No real request, token acquisition or credential test was made. An explicit future
per-action authorization and reviewed code change are prerequisites for writes;
none of this document enables them.
