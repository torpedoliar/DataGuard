import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { epdrAttemptEvents, epdrSiteSettings, epdrWorkerHeartbeats } from "@/db/schema";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn() }));
vi.mock("@/db", () => ({ db: mocks }));
import {
  DEFAULT_EXECUTION_COOLDOWN_MINUTES,
  countRecentDispatches,
  effectiveExecutionLimits,
  hasRecentDispatch,
  loadEffectiveExecutionLimits,
} from "./execution-store";

const dialect = new PgDialect();
const queries = () => mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation((fn) => fn({ execute: mocks.execute }));
});
afterEach(() => vi.unstubAllGlobals());

describe("effective execution limits", () => {
  it("narrows the global cap and never raises it", () => {
    expect(effectiveExecutionLimits(30, 50, 5)).toEqual({ maxActionsPerHour: 30, executionCooldownMinutes: 5 });
    expect(effectiveExecutionLimits(30, 10, 5)).toEqual({ maxActionsPerHour: 10, executionCooldownMinutes: 5 });
  });

  it("falls back to the global cap and default cooldown when the site row is missing", () => {
    expect(effectiveExecutionLimits(30, null, null)).toEqual({
      maxActionsPerHour: 30,
      executionCooldownMinutes: DEFAULT_EXECUTION_COOLDOWN_MINUTES,
    });
  });

  it("reads both settings rows in one query", async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [{ global_max_actions_per_hour: 30, site_max_actions_per_hour: 12, execution_cooldown_minutes: 5 }],
    });
    await expect(loadEffectiveExecutionLimits(4)).resolves.toEqual({ maxActionsPerHour: 12, executionCooldownMinutes: 5 });
    expect(queries()[0].sql).toContain("watchguard_global_settings");
    expect(queries()[0].sql).toContain("epdr_site_settings");
  });

  it("defaults to the safe values when no settings row exists", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] });
    await expect(loadEffectiveExecutionLimits(4)).resolves.toEqual({
      maxActionsPerHour: 30,
      executionCooldownMinutes: DEFAULT_EXECUTION_COOLDOWN_MINUTES,
    });
  });
});

describe("cooldown and hourly-count helpers", () => {
  it("skips the cooldown query entirely for a zero-minute cooldown", async () => {
    await expect(hasRecentDispatch(4, 8, 2, "scan", 0)).resolves.toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("scopes the cooldown lookup to the connection and can exclude its own claim", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 9 }] });
    await expect(hasRecentDispatch(4, 8, 2, "scan", 10, 9)).resolves.toBe(true);
    const [query] = queries();
    expect(query.sql).toContain("connection_id =");
    expect(query.sql).toContain("action_type =");
    expect(query.sql).toContain("dispatched_at IS NOT NULL");
    expect(query.sql).toContain("interval '10 minutes'");
    expect(query.sql).toContain("id <>");
    expect(query.params).toContain(4);
  });

  it("counts committed dispatch attempts per connection", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ total: 3 }] });
    await expect(countRecentDispatches(4, 8, 9)).resolves.toBe(3);
    const [query] = queries();
    expect(query.sql).toContain("epdr_attempts");
    expect(query.sql).toContain("phase = 'dispatch'");
    expect(query.sql).toContain("interval '1 hour'");
    expect(query.sql).toContain("a.action_id <>");
    expect(query.params).toContain(8);
  });
});

describe("0085 schema and migration parity", () => {
  it("declares the per-site limit columns, attempt events and worker heartbeats", () => {
    const settings = getTableConfig(epdrSiteSettings);
    const cooldown = settings.columns.find((column) => column.name === "execution_cooldown_minutes");
    const cap = settings.columns.find((column) => column.name === "max_actions_per_hour");
    const attemptRetention = settings.columns.find((column) => column.name === "execution_attempt_retention_days");
    const resultRetention = settings.columns.find((column) => column.name === "execution_result_retention_days");
    expect(cooldown?.hasDefault).toBe(true);
    expect(cap?.notNull).toBe(false);
    expect(attemptRetention?.hasDefault).toBe(true);
    expect(resultRetention?.hasDefault).toBe(true);

    const events = getTableConfig(epdrAttemptEvents);
    expect(events.name).toBe("epdr_attempt_events");
    expect(events.columns.map((column) => column.name)).toEqual(
      ["id", "action_id", "attempt", "phase", "event", "detail", "created_at"],
    );
    const heartbeats = getTableConfig(epdrWorkerHeartbeats);
    expect(heartbeats.columns.find((column) => column.name === "worker_id")?.primary).toBe(true);
    expect(heartbeats.columns.find((column) => column.name === "last_pass_ran")?.notNull).toBe(true);
  });

  it("keeps the hand-written 0085 migration aligned with the schema", () => {
    const migration = readFileSync("drizzle/0085_epdr_provider_writes_hardening.sql", "utf8");
    expect(migration).toContain("execution_cooldown_minutes integer NOT NULL DEFAULT 10");
    expect(migration).toContain("max_actions_per_hour integer");
    expect(migration).toContain("CHECK (execution_cooldown_minutes >= 0 AND execution_cooldown_minutes <= 1440)");
    expect(migration).toContain("CHECK (max_actions_per_hour IS NULL OR (max_actions_per_hour >= 1 AND max_actions_per_hour <= 10000))");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS epdr_attempt_events");
    expect(migration).toContain("worker_id text PRIMARY KEY");
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS epdr_attempts_phase_started_idx");
    expect(migration).toContain("WHERE state = 'queued' AND mode = 'approval' AND namespace IS NOT NULL");
    expect(migration).toContain("epdr_provider_incidents_connection_revision_ts_idx");
    expect(migration).toContain("last_provider_sync_at timestamptz");
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    expect(journal.entries.at(-1)).toMatchObject({ idx: 85, tag: "0085_epdr_provider_writes_hardening" });
  });
});
