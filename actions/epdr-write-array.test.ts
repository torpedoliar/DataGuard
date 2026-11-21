import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), audit: vi.fn(), superadmin: vi.fn() }));
vi.mock("@/lib/action-auth", () => ({
  requireActiveSiteAdminAction: async () => ({ ok: true, activeSiteId: 7, session: { userId: 1, role: "superadmin" } }),
  requireSuperadminAction: () => mocks.superadmin(),
}));
vi.mock("@/db", () => ({ db: { transaction: async (run: (tx: unknown) => Promise<unknown>) => run({ execute: mocks.execute }) } }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/epdr/execution-store", () => ({ DEFAULT_EXECUTION_COOLDOWN_MINUTES: 10 }));
import { saveEpdrWriteSettings } from "./epdr-write-settings";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.execute.mockResolvedValue({ rows: [], rowCount: 1 });
  mocks.superadmin.mockResolvedValue({ ok: true });
});

describe("write settings allowlist SQL", () => {
  it.each([{ actions: [] }, { actions: ["scan"] }, { actions: ["isolate", "scan"] }])("binds $actions as one PostgreSQL array, never a tuple", async ({ actions }) => {
    const result = await saveEpdrWriteSettings({
      globalEnabled: false, siteEnabled: false,
      globalAllowedActions: actions, siteAllowedActions: actions,
      confirmWriteEnablement: true,
    });
    expect(result).toEqual({ ok: true });
    const queries = mocks.execute.mock.calls.map(([query]) => new PgDialect().sqlToQuery(query as SQL));
    expect(queries).toHaveLength(2);
    const expected = [...actions].sort();
    for (const query of queries) {
      expect(query.sql).not.toContain("()::text[]");
      const arrays = query.params.filter(Array.isArray);
      expect(arrays.length).toBeGreaterThan(0);
      for (const array of arrays) expect(array).toEqual(expected);
      expect(query.sql).toMatch(/\$\d+::text\[\]/);
    }
    expect(mocks.audit).toHaveBeenCalledOnce();
  });

  it("does not write without explicit confirmation", async () => {
    expect(await saveEpdrWriteSettings({ siteAllowedActions: ["scan"] })).toEqual({ code: "invalid_input" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("keeps the superadmin gate for deployment-wide changes", async () => {
    mocks.superadmin.mockResolvedValue({ ok: false });
    expect(await saveEpdrWriteSettings({ globalAllowedActions: ["scan"], confirmWriteEnablement: true })).toEqual({ code: "forbidden" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
