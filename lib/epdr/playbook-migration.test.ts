import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "drizzle/0073_epdr_playbook_history.sql"), "utf8");

describe("playbook history handwritten migration contract", () => {
  it("has a journal entry and no provider execution mode", () => {
    const journal = JSON.parse(readFileSync(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8"));
    expect(journal.entries.filter((entry: { tag: string }) => entry.tag === "0073_epdr_playbook_history")).toHaveLength(1);
    expect(migration).toContain("CHECK (mode = 'simulate')");
    expect(migration).toContain("CHECK (status = 'simulation_recorded')");
    expect(migration).not.toMatch(/ALTER TABLE|DROP TABLE|provider_task_id|dispatch|pending/i);
  });
  it("binds run versions to the same site and retains immutable version provenance", () => {
    expect(migration).toContain("FOREIGN KEY (version_id, site_id)");
    expect(migration).toContain("REFERENCES epdr_playbook_versions(id, site_id)");
    expect(migration).toContain("UNIQUE (site_id, template_id, version)");
    expect(migration).toContain("definition jsonb NOT NULL");
    expect(migration).toContain("created_by integer REFERENCES users(id) ON DELETE SET NULL");
  });
});
