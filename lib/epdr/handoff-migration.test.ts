import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const migration = readFileSync(resolve(process.cwd(), "drizzle/0074_epdr_incident_handoffs.sql"), "utf8");
describe("local handoff migration contract", () => {
  it("registers the handwritten migration and binds site/connection", () => {
    const journal = JSON.parse(readFileSync(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8"));
    expect(journal.entries.filter((entry: { tag: string }) => entry.tag === "0074_epdr_incident_handoffs")).toHaveLength(1);
    expect(migration).toContain("FOREIGN KEY (connection_id, site_id)");
    expect(migration).toContain("REFERENCES watchguard_connections(id, site_id)");
  });
  it("deduplicates per detection and stores PIC independently of assignee", () => {
    expect(migration).toContain("detection_id integer NOT NULL UNIQUE");
    expect(migration).toContain("assignee_id integer REFERENCES users(id)");
    expect(migration).toContain("pic_group_id integer REFERENCES device_groups(id)");
    expect(migration).toContain("requested_by integer REFERENCES users(id)");
    expect(migration).not.toMatch(/DROP TABLE|ALTER TABLE|provider_task|dispatch|pending/i);
  });
});
