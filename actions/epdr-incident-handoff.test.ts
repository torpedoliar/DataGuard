import { readFileSync } from "node:fs";
import { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(), execute: vi.fn(), transaction: vi.fn(), txExecute: vi.fn(), dueDate: vi.fn(),
}));
vi.mock("@/db", () => ({ db: { execute: mocks.execute, transaction: mocks.transaction } }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAdminAction: mocks.guard }));
vi.mock("@/lib/incidents", () => ({ calculateIncidentDueDate: mocks.dueDate }));

// Keep the real assertReadSyncActor: revocation must be checked using locked SQL,
// not merely a second invocation of an authorization mock.
import { createEpdrIncidentHandoff, getEpdrHandoffOptions } from "./epdr-incident-handoff";

const dialect = new PgDialect();
const compile = (query: SQL) => {
  const result = dialect.sqlToQuery(query);
  return { sql: result.sql.replace(/\s+/g, " ").trim(), params: result.params };
};
const tx = { execute: mocks.txExecute };
const input = () => ({ detectionId: 31, assigneeId: 41, picGroupId: 51, note: "Review locally" });
const unavailable = { message: "Local handoff unavailable. No provider action was requested." };
const dueDate = new Date("2026-11-10T12:00:00.000Z");
const queries = () => mocks.txExecute.mock.calls.map(([query]) => compile(query as SQL));
const find = (fragment: string) => {
  const query = queries().find((entry) => entry.sql.includes(fragment));
  expect(query, fragment).toBeDefined();
  return query!;
};
const writes = () => queries().filter(({ sql }) => /^(INSERT|UPDATE|DELETE)\b/.test(sql));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 17, session: { userId: 9 } });
  mocks.dueDate.mockReturnValue(dueDate);
  mocks.transaction.mockImplementation(async (callback: (connection: typeof tx) => unknown) => callback(tx));
  mocks.txExecute.mockImplementation(async (query: SQL) => {
    const { sql } = compile(query);
    if (sql.includes("FROM watchguard_connections")) return { rows: [{ id: 23, account_revision: 7 }] };
    if (sql.includes("FROM epdr_detections")) return { rows: [{ incident_id: null, endpoint_id: 61, category: "malware", severity: "High" }] };
    if (sql.includes("SELECT u.role")) return { rows: [{ role: "admin" }] };
    if (sql.includes("FROM user_sites")) return { rows: [{ id: 91 }] };
    if (sql.includes("FROM epdr_endpoints")) return { rows: [{ id: 61, device_id: 71 }] };
    if (sql.includes("FROM users u")) return { rows: [{ id: 41, name: "Operator" }] };
    if (sql.includes("FROM device_groups")) return { rows: [{ id: 51, name: "PIC" }] };
    if (sql.includes("FROM devices")) return { rows: [{ id: 71 }] };
    if (sql.startsWith("INSERT INTO incidents")) return { rows: [{ id: 81 }] };
    if (sql.includes("FROM incidents")) return { rows: [{ id: 81 }] };
    return { rows: [] };
  });
});

function overrideRows(fragment: string, rows: unknown[]) {
  const original = mocks.txExecute.getMockImplementation()!;
  mocks.txExecute.mockImplementation((query: SQL) => compile(query).sql.includes(fragment)
    ? Promise.resolve({ rows }) : original(query));
}

function expectNoStorage() {
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.txExecute).not.toHaveBeenCalled();
  expect(mocks.execute).not.toHaveBeenCalled();
}

describe("EPDR local incident handoff authorization and strict input", () => {
  it.each(["unauthenticated", "not an active-site administrator", "no active site"])("denies %s before storage", async (message) => {
    mocks.guard.mockResolvedValue({ ok: false, message });
    expect(await createEpdrIncidentHandoff(input())).toEqual({ message });
    expect(await getEpdrHandoffOptions()).toEqual({ message });
    expectNoStorage();
  });

  it.each([
    null, {}, { ...input(), siteId: 999 }, { ...input(), connectionId: 999 },
    { ...input(), incidentId: 81 }, { ...input(), source: "provider" },
    { ...input(), automationHold: false }, { ...input(), action: "isolate" },
    { ...input(), detectionId: "31" }, { ...input(), detectionId: 0 },
    { ...input(), detectionId: 1.5 }, { ...input(), detectionId: 2147483648 },
    { ...input(), assigneeId: 0 }, { ...input(), assigneeId: "41" },
    { ...input(), picGroupId: -1 }, { ...input(), picGroupId: 1.5 },
    { ...input(), assigneeId: undefined }, { ...input(), picGroupId: undefined },
    { ...input(), note: " \n " }, { ...input(), note: "x".repeat(501) },
  ])("rejects invalid or authority-bearing input %#", async (value) => {
    expect(await createEpdrIncidentHandoff(value)).toEqual({ message: "Invalid local handoff." });
    expectNoStorage();
  });
});

describe("EPDR handoff locked transaction", () => {
  it("locks the current site connection, detection and actor before validating independent assignments", async () => {
    expect(await createEpdrIncidentHandoff(input())).toEqual({ incidentId: 81, existing: false });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(queries().slice(0, 4)).toEqual([
      { sql: "SELECT c.id, c.account_revision FROM watchguard_connections c WHERE c.site_id = $1 AND c.enabled = true FOR UPDATE", params: [17] },
      { sql: "SELECT incident_id, endpoint_id, category, severity FROM epdr_detections WHERE id = $1 AND site_id = $2 AND connection_id = $3 AND account_revision = $4 FOR UPDATE", params: [31, 17, 23, 7] },
      { sql: "SELECT u.role FROM users u JOIN sites s ON s.id = $1 WHERE u.id = $2 AND u.is_active = true AND s.is_active = true FOR SHARE OF u, s", params: [17, 9] },
      { sql: "SELECT id FROM user_sites WHERE user_id = $1 AND site_id = $2 AND role_in_site = 'admin' FOR SHARE", params: [9, 17] },
    ]);
    expect(find("FROM epdr_endpoints")).toEqual({
      sql: "SELECT id, device_id FROM epdr_endpoints WHERE id = $1 AND site_id = $2 AND connection_id = $3 AND account_revision = $4 AND removed_at IS NULL FOR SHARE", params: [61, 17, 23, 7],
    });
    expect(find("SELECT u.id FROM users")).toEqual({
      sql: "SELECT u.id FROM users u JOIN user_sites m ON m.user_id = u.id WHERE u.id = $1 AND u.is_active = true AND m.site_id = $2 FOR SHARE OF u, m", params: [41, 17],
    });
    expect(find("FROM device_groups")).toEqual({
      sql: "SELECT id FROM device_groups WHERE id = $1 AND site_id = $2 AND is_active = true FOR SHARE", params: [51, 17],
    });
    expect(find("FROM devices")).toEqual({
      sql: "SELECT id FROM devices WHERE id = $1 AND site_id = $2 AND is_active = true FOR SHARE", params: [71, 17],
    });
    expect(writes()).toEqual([
      { sql: "INSERT INTO incidents (site_id, device_id, epdr_endpoint_id, title, description, severity, status, source, automation_hold, created_by_id, assigned_to_id, due_date) VALUES ($1, $2, $3, $4, $5, $6, 'Open', 'epdr_manual', true, $7, $8, $9) RETURNING id",
        params: [17, 71, 61, "EPDR local review · detection #31", "Review locally", "High", 9, 41, dueDate] },
      { sql: "INSERT INTO incident_updates (incident_id, author_id, update_type, note, new_status) VALUES ($1, $2, 'created', $3, 'Open')",
        params: [81, 9, "Explicit EPDR local handoff for detection #31. PIC group #51; assignee #41. No notification or provider command requested. Review locally"] },
      { sql: "INSERT INTO epdr_incident_handoffs (site_id, detection_id, incident_id, connection_id, account_revision, requested_by, assignee_id, pic_group_id, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        params: [17, 31, 81, 23, 7, 9, 41, 51, "Review locally"] },
      { sql: "UPDATE epdr_detections SET incident_id = $1 WHERE id = $2 AND site_id = $3 AND incident_id IS NULL", params: [81, 31, 17] },
    ]);
    expect(mocks.dueDate).toHaveBeenCalledWith("High");
  });

  it("returns a same-site existing Incident without overwriting assignment, PIC or note", async () => {
    overrideRows("FROM epdr_detections", [{ incident_id: 81, endpoint_id: null, category: "malware", severity: "High" }]);
    expect(await createEpdrIncidentHandoff({ ...input(), assigneeId: 999, picGroupId: 998 })).toEqual({ incidentId: 81, existing: true });
    expect(find("FROM incidents")).toEqual({ sql: "SELECT id FROM incidents WHERE id = $1 AND site_id = $2 FOR SHARE", params: [81, 17] });
    expect(find("SELECT u.role")).toBeDefined();
    expect(writes()).toEqual([]);
    expect(queries()).toHaveLength(5);
    expect(mocks.dueDate).not.toHaveBeenCalled();
  });

  it("rejects an existing linked Incident missing from the active site", async () => {
    overrideRows("FROM epdr_detections", [{ incident_id: 81, endpoint_id: 61 }]);
    overrideRows("FROM incidents", []);
    expect(await createEpdrIncidentHandoff(input())).toEqual(unavailable);
    expect(writes()).toEqual([]);
  });

  it.each([
    ["disabled/missing current connection", "FROM watchguard_connections"],
    ["detection missing or belonging to another site/connection", "FROM epdr_detections"],
    ["revoked/inactive actor or site", "SELECT u.role"],
    ["revoked active-site admin membership", "FROM user_sites"],
    ["removed or site/connection-mismatched endpoint", "FROM epdr_endpoints"],
    ["inactive or cross-site assignee", "SELECT u.id FROM users"],
    ["inactive or cross-site PIC", "FROM device_groups"],
    ["inactive or cross-site asset", "FROM devices"],
  ])("rejects %s before writes", async (_label, fragment) => {
    overrideRows(fragment, []);
    expect(await createEpdrIncidentHandoff(input())).toEqual(unavailable);
    expect(writes()).toEqual([]);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("rejects an unresolved endpoint rather than creating an unbound incident", async () => {
    overrideRows("FROM epdr_detections", [{ incident_id: null, endpoint_id: null }]);
    expect(await createEpdrIncidentHandoff(input())).toEqual(unavailable);
    expect(queries().some(({ sql }) => sql.includes("FROM epdr_endpoints"))).toBe(false);
    expect(writes()).toEqual([]);
  });

  it("allows null assignments and an endpoint without an asset, trims notes and normalizes severity", async () => {
    overrideRows("FROM epdr_endpoints", [{ id: 61, device_id: null }]);
    overrideRows("FROM epdr_detections", [{ incident_id: null, endpoint_id: 61, severity: "provider-unknown" }]);
    expect(await createEpdrIncidentHandoff({ ...input(), assigneeId: null, picGroupId: null, note: "  local review  " })).toEqual({ incidentId: 81, existing: false });
    expect(queries().some(({ sql }) => /FROM (devices|device_groups)|SELECT u.id FROM users/.test(sql))).toBe(false);
    expect(find("INSERT INTO incidents").params).toEqual([17, null, 61, "EPDR local review · detection #31", "local review", "Medium", 9, null, dueDate]);
    expect(find("INSERT INTO epdr_incident_handoffs").params).toEqual([17, 31, 81, 23, 7, 9, null, null, "local review"]);
  });

  it("allows a current active superadmin without requiring a site admin membership", async () => {
    overrideRows("SELECT u.role", [{ role: "superadmin" }]);
    expect(await createEpdrIncidentHandoff(input())).toEqual({ incidentId: 81, existing: false });
    expect(queries().some(({ sql }) => sql.includes("FROM user_sites"))).toBe(false);
  });

  it("rejects a missing INSERT RETURNING result without publishing a link", async () => {
    overrideRows("INSERT INTO incidents", []);
    expect(await createEpdrIncidentHandoff(input())).toEqual(unavailable);
    expect(writes()).toHaveLength(1);
  });

  it.each(["INSERT INTO incidents", "INSERT INTO incident_updates", "INSERT INTO epdr_incident_handoffs", "UPDATE epdr_detections"])("propagates %s failure out of the transaction and reports only a safe failure", async (fragment) => {
    const original = mocks.txExecute.getMockImplementation()!;
    const failure = new Error("private SQL, password and provider payload");
    mocks.txExecute.mockImplementation((query: SQL) => {
      if (compile(query).sql.startsWith(fragment)) throw failure;
      return original(query);
    });
    let transactionFailure: unknown;
    mocks.transaction.mockImplementation(async (callback: (connection: typeof tx) => unknown) => {
      try { return await callback(tx); } catch (error) { transactionFailure = error; throw error; }
    });
    expect(await createEpdrIncidentHandoff(input())).toEqual(unavailable);
    expect(transactionFailure).toBe(failure);
    expect(writes().at(-1)?.sql.startsWith(fragment)).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("safely handles a transaction acquisition/commit failure", async () => {
    mocks.transaction.mockRejectedValue(new Error("private connection details"));
    expect(await createEpdrIncidentHandoff(input())).toEqual(unavailable);
  });
});

describe("bounded site-local handoff options and local-only effects", () => {
  it("rechecks the actor in a transaction and independently bounds both active-site option lists to 200", async () => {
    expect(await getEpdrHandoffOptions()).toEqual({ assignees: [{ id: 41, name: "Operator" }], picGroups: [{ id: 51, name: "PIC" }] });
    expect(find("SELECT u.role").params).toEqual([17, 9]);
    expect(find("SELECT DISTINCT u.id, u.username AS name")).toEqual({
      sql: "SELECT DISTINCT u.id, u.username AS name FROM users u JOIN user_sites m ON m.user_id = u.id AND m.site_id = $1 WHERE u.is_active = true ORDER BY name, u.id LIMIT 200", params: [17],
    });
    expect(find("FROM device_groups")).toEqual({
      sql: "SELECT id, name FROM device_groups WHERE site_id = $1 AND is_active = true ORDER BY name, id LIMIT 200", params: [17],
    });
    expect(writes()).toEqual([]);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it.each(["SELECT u.role", "FROM user_sites"])("does not disclose options after revocation at %s", async (fragment) => {
    overrideRows(fragment, []);
    expect(await getEpdrHandoffOptions()).toEqual({ message: "Handoff options unavailable." });
    expect(queries().some(({ sql }) => sql.includes("FROM device_groups") || sql.includes("SELECT DISTINCT u.id, u.username AS name"))).toBe(false);
  });

  it("does not expose option storage failures", async () => {
    mocks.txExecute.mockRejectedValue(new Error("private database details"));
    expect(await getEpdrHandoffOptions()).toEqual({ message: "Handoff options unavailable." });
  });

  it("imports no provider mutation, incident automation, or notification dispatch implementation", async () => {
    const source = readFileSync(new URL("./epdr-incident-handoff.ts", import.meta.url), "utf8");
    expect([...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1])).toEqual([
      "drizzle-orm", "@/db", "@/lib/action-auth", "@/lib/epdr/read-sync-queue", "@/lib/epdr/incident-handoff", "@/lib/incidents",
    ]);
    expect(source).not.toMatch(/\b(?:fetch|sendNotification|sendTelegram|dispatch|executeProviderAction)\s*\(/);
    await createEpdrIncidentHandoff(input());
    expect(writes().map(({ sql }) => sql.match(/^(?:INSERT INTO|UPDATE) (\w+)/)?.[1])).toEqual([
      "incidents", "incident_updates", "epdr_incident_handoffs", "epdr_detections",
    ]);
  });
});
