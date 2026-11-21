import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { epdrResponseBindings, epdrResponseRecommendations, epdrResponseRequestLinks } from "@/db/schema";

const migration = readFileSync(resolve(process.cwd(), "drizzle/0088_epdr_response_bindings.sql"), "utf8");
const dialect = new PgDialect();
describe("0088 response schema parity", () => {
  it("registers 0088 after the preserved timezone migration", () => {
    const journal = JSON.parse(readFileSync(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8"));
    expect(journal.entries.slice(-2).map((entry: { idx: number; tag: string }) => [entry.idx, entry.tag])).toEqual([
      [87, "0087_epdr_time_zones"], [88, "0088_epdr_response_bindings"],
    ]);
  });
  it.each([epdrResponseBindings, epdrResponseRecommendations, epdrResponseRequestLinks])("declares SQL columns and checks", (table) => {
    const config = getTableConfig(table);
    expect(migration).toContain(`CREATE TABLE ${config.name}`);
    for (const column of config.columns) expect(migration).toMatch(new RegExp(`\\b${column.name}\\s`));
    for (const constraint of config.checks) {
      const expression = dialect.sqlToQuery(constraint.value).sql;
      expect(expression).toBeTruthy();
      expect(migration).toContain("CHECK (");
    }
  });
  it("matches revision uniqueness and all scoped foreign key columns", () => {
    const recommendations = getTableConfig(epdrResponseRecommendations);
    expect(recommendations.uniqueConstraints.map((item) => item.columns.map((column) => column.name))).toContainEqual(["binding_id", "detection_id", "read_evidence_id"]);
    for (const table of [epdrResponseBindings, epdrResponseRecommendations, epdrResponseRequestLinks]) {
      for (const fk of getTableConfig(table).foreignKeys) {
        const ref = fk.reference();
        if (ref.columns.length > 1) {
          expect(migration).toContain(`FOREIGN KEY (${ref.columns.map((column) => column.name).join(", ")})`);
        }
      }
    }
  });
  it("matches partial, history and fair-queue indexes", () => {
    const bindings = getTableConfig(epdrResponseBindings);
    const recommendations = getTableConfig(epdrResponseRecommendations);
    const active = bindings.indexes.find((item) => item.config.name === "epdr_response_bindings_active")!;
    expect(active.config.where).toBeDefined();
    expect(migration).toContain("epdr_response_bindings(connection_id, id) WHERE state = 'active'");
    expect(recommendations.indexes.map((item) => item.config.name)).toEqual([
      "epdr_response_recommendations_history", "epdr_response_recommendations_fair_queue",
    ]);
    expect(migration).toContain("epdr_response_recommendations(site_id, id DESC)");
    expect(migration).toContain("epdr_response_recommendations(binding_id, detection_id, created_at DESC)");
    expect(migration).toContain("BEFORE UPDATE ON epdr_response_recommendations");
  });
});
