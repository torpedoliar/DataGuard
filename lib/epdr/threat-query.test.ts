import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { THREAT_PAGE_SIZE, threatOffset, threatQuerySchema, threatWhere, threatEndpointJoin } from "./threat-query";

const dialect = new PgDialect();
const now = new Date("2026-01-02T03:04:05Z");
const parse = (value: Record<string, unknown>) => threatQuerySchema.parse(value);

describe("threat table query contract", () => {
  it("pins the 30-day window, excludes future events and matches count/table predicates", () => {
    const q = parse({ page: 3, category: "malware", source: "threatsync", scoreMode: "range", minScore: 7, maxScore: 10 });
    const sql = dialect.sqlToQuery(threatWhere(7, q, now)!);
    expect(sql.sql).toContain('"epdr_detections"."site_id" = $1');
    expect(sql.sql).toContain('"epdr_detections"."detected_at" >=');
    expect(sql.sql).toContain('"epdr_detections"."detected_at" <=');
    expect(sql.params[0]).toBe(7);
    expect(sql.params).toContain(now.toISOString());
    expect(threatOffset(q)).toBe(2 * THREAT_PAGE_SIZE);
  });
  it("keeps missing scores separate from any score", () => {
    expect(dialect.sqlToQuery(threatWhere(7, parse({ scoreMode: "missing" }), now)!).sql)
      .toContain('"epdr_detections"."threat_score" is null');
    expect(dialect.sqlToQuery(threatWhere(7, parse({ scoreMode: "any" }), now)!).sql)
      .not.toContain("threat_score");
  });
  it("joins endpoints only within the same account revision", () => {
    const join = dialect.sqlToQuery(threatEndpointJoin(7)!);
    expect(join.sql).toContain('"epdr_endpoints"."account_revision" = "epdr_detections"."account_revision"');
    expect(join.params).toEqual([7]);
  });
  it.each([{ scoreMode: "range", minScore: 8, maxScore: 2 }, { page: 0 }, { query: "x".repeat(101) }, { sort: "random" }])("rejects invalid query %j", (patch) => {
    expect(threatQuerySchema.safeParse(patch).success).toBe(false);
  });
});
