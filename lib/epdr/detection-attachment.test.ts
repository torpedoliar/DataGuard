import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { db } from "@/db";
vi.mock("@/db", () => ({ db: {} }));
import { attachDetectionOnce } from "./detection-attachment";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const binding = { connectionId: 8, siteId: 7, accountRevision: 3 };

describe("detection attachment coordination with manual handoff", () => {
  it.each(["binding", "missing", "linked"])("does not correlate when %s already prevents attachment", async (kind) => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: kind === "binding" ? [] : [{ id: 8 }] })
      .mockResolvedValueOnce({ rows: kind === "missing" ? [] : [{ incident_id: 99 }] });
    const correlate = vi.fn();
    await attachDetectionOnce({ execute } as unknown as Transaction, binding, 10, correlate);
    expect(correlate).not.toHaveBeenCalled();
  });
  it("locks binding then detection and links only the transaction result", async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [{ id: 8 }] })
      .mockResolvedValueOnce({ rows: [{ incident_id: null }] }).mockResolvedValueOnce({ rows: [] });
    const correlate = vi.fn(async () => 42);
    await attachDetectionOnce({ execute } as unknown as Transaction, binding, 10, correlate);
    expect(correlate).toHaveBeenCalledOnce();
    const queries = execute.mock.calls.map(([query]) => new PgDialect().sqlToQuery(query));
    expect(queries[0].sql).toContain("watchguard_connections");
    expect(queries[0].sql).toContain("account_revision");
    expect(queries[1].sql).toContain("epdr_detections");
    expect(queries[1].sql).toContain("FOR UPDATE");
    expect(queries[1].params).toEqual([10, 8, 7, 3]);
    expect(queries[1].sql).toContain("account_revision");
    expect(queries[2].params).toEqual([42, 10, 7]);
    expect(queries[2].sql).toContain("incident_id IS NULL");
  });
  it("does not publish a missing result or swallow correlation failure", async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [{ id: 8 }] }).mockResolvedValueOnce({ rows: [{ incident_id: null }] });
    await attachDetectionOnce({ execute } as unknown as Transaction, binding, 10, async () => null);
    expect(execute).toHaveBeenCalledTimes(2);
    execute.mockResolvedValueOnce({ rows: [{ id: 8 }] }).mockResolvedValueOnce({ rows: [{ incident_id: null }] });
    await expect(attachDetectionOnce({ execute } as unknown as Transaction, binding, 10, async () => { throw new Error("rollback"); })).rejects.toThrow("rollback");
  });
});
