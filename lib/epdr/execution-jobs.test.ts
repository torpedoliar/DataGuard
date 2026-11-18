import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn() }));
vi.mock("@/db", () => ({ db: mocks }));
import { claimNextDispatch, expireExpiredApprovals } from "./execution-jobs";
import { executionSnapshotHash, type ExecutionSnapshot } from "./execution-request";

const dialect = new PgDialect();
const queries = () => mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation((fn) => fn({ execute: mocks.execute }));
});

describe("expired-approval sweep", () => {
  it("cancels only pending/queued requests past their approval window", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 3 }] });
    await expect(expireExpiredApprovals(8)).resolves.toBe(1);
    const [query] = queries();
    expect(query.sql).toContain("state IN ('pending_approval', 'queued')");
    expect(query.sql).toContain("approval_expires_at <= clock_timestamp()");
    expect(query.sql).toContain("'approval_expired'");
    expect(query.sql).toContain("connection_id =");
    expect(query.params).toContain(8);
  });
});

describe("atomic dispatch claim", () => {
  const snapshot: ExecutionSnapshot = {
    siteId: 4,
    connectionId: 8,
    region: "us",
    accountId: "acct",
    target: { endpointId: 2, deviceId: "dev-1", entityId: null, providerIncidentId: null },
    namespace: "endpoint_security",
    actionType: "scan",
    parameters: {},
    accountRevision: 1,
    credentialRevision: 2,
    evidenceGeneration: 3,
    requesterId: 1,
    expiresAt: Date.now() + 60_000,
  };
  const hash = executionSnapshotHash(snapshot);

  /** Limits query → hourly count → candidate → claim UPDATE → attempt insert → claimed event. */
  function claimMocks(overrides: Partial<{ gatesOpen: boolean; used: number; cooldown: number; cap: number; candidate: boolean; claimGeneration: number }> = {}) {
    return mocks.execute
      .mockResolvedValueOnce({
        rows: [{
          site_id: 4,
          cap: overrides.cap ?? 30,
          cooldown_minutes: overrides.cooldown ?? 10,
          gates_open: overrides.gatesOpen ?? true,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ used: overrides.used ?? 0 }] })
      .mockResolvedValueOnce({
        rows: overrides.candidate === false ? [] : [{
          id: 11, action_type: "scan", endpoint_id: 2, snapshot, snapshot_hash: hash,
          approved_by: 5, approval_expires_at: new Date(Date.now() + 60_000), generation: 1,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ generation: overrides.claimGeneration ?? 7, attempt: 2 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
  }

  it("locks the connection row, reads LEAST(site, global) limits and counts committed attempts", async () => {
    claimMocks({ candidate: false });
    await expect(claimNextDispatch(4, 8, "worker:t")).resolves.toBeNull();

    const [limits, count, candidates] = queries();
    expect(limits.sql).toContain("FOR UPDATE OF c");
    expect(limits.sql).toContain("least(coalesce(s.max_actions_per_hour, g.max_actions_per_hour_per_site)");
    expect(limits.sql).toContain("coalesce(s.execution_cooldown_minutes,");
    expect(limits.sql).toContain("s.automation_paused_at IS NULL");
    expect(limits.params).toContain(8);

    expect(count.sql).toContain("epdr_attempts");
    expect(count.sql).toContain("phase = 'dispatch'");
    expect(count.sql).toContain("interval '1 hour'");

    expect(candidates.sql).toContain("AND NOT EXISTS (");
    expect(candidates.sql).toContain("prev.dispatched_at > clock_timestamp() - interval '10 minutes'");
    expect(candidates.sql).toContain("FOR UPDATE OF x SKIP LOCKED");
    expect(candidates.sql).toContain("state = 'queued'");
    expect(candidates.sql).toContain("approval_expires_at > clock_timestamp()");
  });

  it("claims the candidate, commits the attempt row and the claimed event in one transaction", async () => {
    claimMocks();
    // Post-claim revalidation: writes disabled → transient block → abort to queued.
    mocks.execute.mockResolvedValueOnce({
      rows: [{
        global_writes_enabled: false, kill_switch: false, allowed_actions: ["scan"],
        max_actions_per_hour_per_site: 30, approval_expiry_minutes: 60,
        site_writes_enabled: false, site_allowed_actions: ["scan"], site_kill_switch: false,
        automation_paused_at: null, site_max_actions_per_hour: null, execution_cooldown_minutes: 10,
      }],
    });
    await expect(claimNextDispatch(4, 8, "worker:t")).resolves.toBeNull();

    // Query 4 = claim UPDATE, 5 = attempt insert, 6 = claimed event.
    const [claimUpdate, attemptInsert, claimedEvent] = queries().slice(3, 6);
    expect(claimUpdate.sql).toContain("state = 'dispatching'");
    expect(claimUpdate.sql).toContain("generation = generation + 1");
    expect(claimUpdate.sql).toContain("dispatched_at = clock_timestamp()");
    expect(attemptInsert.sql).toContain("INSERT INTO epdr_attempts");
    expect(attemptInsert.sql).toContain("'sending', 'dispatch'");
    expect(claimedEvent.sql).toContain("INSERT INTO epdr_attempt_events");
    expect(claimedEvent.sql).toContain("'dispatch', 'claimed'");
    expect(claimedEvent.params.some((param) => typeof param === "string" && param.includes('"workerId":"worker:t"'))).toBe(true);
  });

  it("reverts a transient post-claim block to queued, aborts the attempt and clears dispatched_at", async () => {
    claimMocks();
    mocks.execute.mockResolvedValueOnce({
      rows: [{
        global_writes_enabled: false, kill_switch: false, allowed_actions: ["scan"],
        max_actions_per_hour_per_site: 30, approval_expiry_minutes: 60,
        site_writes_enabled: false, site_allowed_actions: ["scan"], site_kill_switch: false,
        automation_paused_at: null, site_max_actions_per_hour: null, execution_cooldown_minutes: 10,
      }],
    });
    await expect(claimNextDispatch(4, 8, "worker:t")).resolves.toBeNull();

    const abort = queries().slice(-3);
    const [actionUpdate, attemptUpdate, abortedEvent] = abort;
    expect(actionUpdate.sql).toContain("dispatched_at = NULL");
    expect(actionUpdate.sql).toContain("state =");
    expect(actionUpdate.params).toContain("queued"); // write_not_enabled is transient
    expect(attemptUpdate.sql).toContain("status = 'aborted'");
    expect(attemptUpdate.params).toContain("write_not_enabled");
    expect(abortedEvent.sql).toContain("'dispatch', 'aborted'");
    expect(abortedEvent.params).toContain(JSON.stringify({ reason: "write_not_enabled", transient: true }));
  });

  it("moves a hard post-claim block to needs_review instead of queued", async () => {
    // Snapshot invalid: revalidation fails before any DB read, so the abort
    // follows the claim transaction directly.
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ site_id: 4, cap: 30, cooldown_minutes: 10, gates_open: true }] })
      .mockResolvedValueOnce({ rows: [{ used: 0 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 11, action_type: "scan", endpoint_id: 2, snapshot: { broken: true }, snapshot_hash: hash,
          approved_by: 5, approval_expires_at: new Date(Date.now() + 60_000), generation: 1,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ generation: 7, attempt: 2 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(claimNextDispatch(4, 8, "worker:t")).resolves.toBeNull();

    const [actionUpdate, attemptUpdate] = queries().slice(-3);
    expect(actionUpdate.params).toContain("needs_review");
    expect(actionUpdate.params).toContain("snapshot_invalid");
    expect(actionUpdate.sql).toContain("dispatched_at = NULL");
    expect(attemptUpdate.params).toContain("snapshot_invalid");
  });

  it("claims nothing when the gates closed or the hourly cap is reached", async () => {
    claimMocks({ gatesOpen: false });
    await expect(claimNextDispatch(4, 8, "worker:t")).resolves.toBeNull();
    expect(mocks.execute).toHaveBeenCalledTimes(1);

    vi.resetAllMocks();
    mocks.transaction.mockImplementation((fn) => fn({ execute: mocks.execute }));
    claimMocks({ used: 30, cap: 30 });
    await expect(claimNextDispatch(4, 8, "worker:t")).resolves.toBeNull();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
});
