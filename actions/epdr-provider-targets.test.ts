import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), execute: vi.fn(), transaction: vi.fn(), audit: vi.fn() }));
vi.mock("@/db", () => ({ db: { execute: mocks.execute, transaction: mocks.transaction } }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAdminAction: mocks.guard }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

import { confirmEpdrProviderTarget, getEpdrProviderTargets } from "./epdr-provider-targets";

const dialect = new PgDialect();
const queries = () => mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 17, session: { userId: 9 } });
  mocks.transaction.mockImplementation(async (callback) => callback({ execute: mocks.execute }));
  mocks.execute.mockResolvedValue({ rows: [] });
});

describe("provider target SQL regressions", () => {
  it("uses PostgreSQL POSITION IN syntax in the mislink query", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 2, account_revision: 3 }] });
    expect(await getEpdrProviderTargets()).toEqual({ candidates: [], mislinked: [], endpoints: [] });
    const query = queries()[2].sql;
    expect(query).toContain("position(':' in substring(d.source_key from 4))");
    expect(query).not.toContain("position(':',");
  });

  it("checks endpoints against the locked incident revision without an out-of-scope target alias", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ entity_id: "entity", review_state: "unreviewed", ts_incident_id: "incident", connection_id: 2, account_revision: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 5 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    expect(await confirmEpdrProviderTarget({ targetId: 7, endpointId: 5 })).toEqual({ ok: true });
    expect(queries()[0].sql).toContain("p.account_revision");
    expect(queries()[0].sql).toContain("FOR UPDATE OF t");
    const endpoint = queries()[1];
    expect(endpoint.sql).not.toContain("t.provider_incident_id");
    expect(endpoint.params).toEqual([5, 17, 2, 3]);
    expect(endpoint.sql).toContain("e.removed_at IS NULL");
  });

  it("refuses an endpoint outside the current scope without updating or auditing", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ entity_id: "entity", review_state: "unreviewed", ts_incident_id: "incident", connection_id: 2, account_revision: 3 }] });
    expect(await confirmEpdrProviderTarget({ targetId: 7, endpointId: 5 })).toEqual({ code: "endpoint_unavailable" });
    expect(queries()).toHaveLength(2);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
