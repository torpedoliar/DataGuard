import { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), admin: vi.fn(), execute: vi.fn(), transaction: vi.fn(), rollback: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAction: mocks.guard, requireActiveSiteAdminAction: mocks.admin }));
import { getEpdrNotificationInbox, getEpdrNotificationPolicy, markEpdrNotificationRead, setEpdrNotificationPolicy } from "./epdr-notifications";
const dialect = new PgDialect();
const compile = (q: SQL) => dialect.sqlToQuery(q);
const text = (q: SQL) => compile(q).sql.replace(/\s+/g, " ").trim();
const queries = () => mocks.execute.mock.calls.map(([q]) => text(q));
let revoked = false;
let dbRole = "admin";
let siteRole = "admin";
beforeEach(() => {
  vi.resetAllMocks(); revoked = false; dbRole = "admin"; siteRole = "admin";
  const guard = { ok: true, activeSiteId: 2, session: { userId: 4 } };
  mocks.guard.mockResolvedValue(guard); mocks.admin.mockResolvedValue(guard);
  mocks.transaction.mockImplementation(async (callback) => {
    try { return await callback({ execute: mocks.execute }); }
    catch (error) { mocks.rollback(); throw error; }
  });
  mocks.execute.mockImplementation(async (q: SQL) => {
    const s = text(q);
    if (s.includes("SELECT u.role")) return { rows: revoked ? [] : [{ role: dbRole }] };
    if (s.includes("FROM user_sites") || s.includes("SELECT u.id")) return { rows: revoked ? [] : [{ id: 4, role_in_site: siteRole }] };
    if (s.includes("RETURNING incident_id")) return { rows: [{ incident_id: 30, outbox_id: 10 }] };
    if (s.includes("SELECT count")) return { rows: [{ count: 7 }] };
    return { rows: [] };
  });
});

describe("local notification actions", () => {
  it("requires explicit admin policy, default disabled and honest local-only scope", async () => {
    expect(await getEpdrNotificationPolicy()).toEqual({ enabled: false, notifyHeld: false, escalateOverdueToAdmins: false, digestEnabled: false, digestHourUtc: null, quietStart: null, quietEnd: null, updatedAt: null, updatedBy: null, channel: "local", recipientScope: "assignee" });
  });
  it("fails closed before storage on authorization failure", async () => {
    mocks.guard.mockResolvedValue({ ok: false, message: "Denied" });
    mocks.admin.mockResolvedValue({ ok: false, message: "Denied" });
    expect(await getEpdrNotificationInbox()).toEqual({ message: "Denied" });
    expect(await getEpdrNotificationPolicy()).toEqual({ message: "Denied" });
    expect(await setEpdrNotificationPolicy({ enabled: true, notifyHeld: false, escalateOverdueToAdmins: false, digestEnabled: false, digestHourUtc: null, quietStart: null, quietEnd: null })).toEqual({ message: "Denied" });
    expect(await markEpdrNotificationRead({ notificationId: 1 })).toEqual({ message: "Denied" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each([{}, { enabled: true }, { enabled: true, notifyHeld: false, escalateOverdueToAdmins: false, digestEnabled: false, digestHourUtc: null, siteId: 99 }, { enabled: "true", notifyHeld: false, escalateOverdueToAdmins: false }])("rejects untrusted policy authority %#", async (input) => {
    expect(await setEpdrNotificationPolicy(input)).toEqual({ message: "Invalid local notification policy." });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("records current actor on both policy and policy audit in one transaction", async () => {
    await setEpdrNotificationPolicy({ enabled: true, notifyHeld: false, escalateOverdueToAdmins: false, digestEnabled: false, digestHourUtc: null, quietStart: null, quietEnd: null });
    const writes = mocks.execute.mock.calls.filter(([q]) => text(q).startsWith("INSERT"));
    expect(compile(writes[0][0]).params).toEqual([2, true, false, null, null, false, false, null, 4]);
    expect(compile(writes[1][0]).params).toEqual([2, 4]);
    expect(text(writes[1][0])).toContain("'policy_changed'");
  });
  it.each([
    { quietStart: null, quietEnd: 7 }, { quietStart: 22, quietEnd: null },
    { quietStart: 7, quietEnd: 7 }, { quietStart: -1, quietEnd: 7 },
    { quietStart: 22, quietEnd: 24 }, { quietStart: 1.5, quietEnd: 7 },
    { quietStart: "22", quietEnd: 7 }, { quietStart: 22, quietEnd: 7, timezone: "guessed" },
  ])("rejects invalid UTC quiet policy %# before storage", async (window) => {
    expect(await setEpdrNotificationPolicy({ enabled: true, notifyHeld: false, escalateOverdueToAdmins: false, digestEnabled: false, digestHourUtc: null, ...window })).toHaveProperty("message");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each([[22, 7], [0, 23]])("persists explicit quiet hours %s/%s atomically", async (quietStart, quietEnd) => {
    await setEpdrNotificationPolicy({ enabled: true, notifyHeld: false, escalateOverdueToAdmins: false, digestEnabled: false, digestHourUtc: null, quietStart, quietEnd });
    const write = mocks.execute.mock.calls.find(([q]) => text(q).startsWith("INSERT INTO epdr_local_notification_policies"))![0];
    expect(compile(write).params).toEqual([2, true, false, quietStart, quietEnd, false, false, null, 4]);
    expect(text(write)).toContain("quiet_start = EXCLUDED.quiet_start");
    expect(queries().some((s) => s.includes("'policy_changed'"))).toBe(true);
  });
  it.each([
    { digestEnabled: true, digestHourUtc: null }, { digestEnabled: false, digestHourUtc: 8 },
    { digestEnabled: true, digestHourUtc: 24 }, { digestEnabled: true, digestHourUtc: 1.5 },
  ])("rejects an inconsistent digest policy %#", async (digest) => {
    expect(await setEpdrNotificationPolicy({ enabled: true, notifyHeld: false, escalateOverdueToAdmins: false, quietStart: null, quietEnd: null, ...digest })).toHaveProperty("message");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("persists an enabled digest hour atomically", async () => {
    await setEpdrNotificationPolicy({ enabled: true, notifyHeld: false, escalateOverdueToAdmins: false,
      digestEnabled: true, digestHourUtc: 8, quietStart: null, quietEnd: null });
    const write = mocks.execute.mock.calls.find(([q]) => text(q).startsWith("INSERT INTO epdr_local_notification_policies"))![0];
    expect(compile(write).params).toEqual([2, true, false, null, null, false, true, 8, 4]);
    expect(text(write)).toContain("digest_enabled = EXCLUDED.digest_enabled");
  });
  it("rolls policy back when audit fails", async () => {
    const impl = mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation(async (q: SQL) => {
      if (text(q).includes("INSERT INTO epdr_local_notification_audit")) throw new Error("synthetic");
      return impl(q);
    });
    expect(await setEpdrNotificationPolicy({ enabled: true, notifyHeld: true, escalateOverdueToAdmins: false, digestEnabled: false, digestHourUtc: null, quietStart: null, quietEnd: null })).toHaveProperty("message");
    expect(mocks.rollback).toHaveBeenCalledOnce();
  });
  it("rechecks current site membership for admin changes and inbox access", async () => {
    revoked = true;
    expect(await setEpdrNotificationPolicy({ enabled: true, notifyHeld: false, escalateOverdueToAdmins: false, digestEnabled: false, digestHourUtc: null, quietStart: null, quietEnd: null })).toHaveProperty("message");
    expect(await getEpdrNotificationInbox()).toHaveProperty("message");
    expect(queries().some((s) => /^(INSERT|UPDATE)/.test(s))).toBe(false);
  });
  it("returns only the active site's own inbox and a separate complete unread count", async () => {
    expect(await getEpdrNotificationInbox()).toEqual({ notifications: [], unreadCount: 7, digest: { assigned: 0, overdue: 0, incidents: 0 } });
    const inbox = mocks.execute.mock.calls.find(([q]) => text(q).includes("SELECT n.id"))![0];
    expect(compile(inbox).params).toEqual([2, 4, true, 4, 4]);
    expect(text(inbox)).toContain("i.site_id = n.site_id");
    expect(text(inbox)).toContain("LIMIT 100");
  });
  it("computes a read-only digest of unread notices under the same visibility rule", async () => {
    const impl = mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation(async (q: SQL) => {
      const statement = text(q);
      if (statement.includes("GROUP BY n.kind")) return { rows: [{ kind: "assigned", count: 3 }, { kind: "overdue", count: 2 }] };
      if (statement.includes("count(DISTINCT n.incident_id)")) return { rows: [{ incidents: 4 }] };
      return impl(q);
    });
    expect(await getEpdrNotificationInbox()).toMatchObject({ digest: { assigned: 3, overdue: 2, incidents: 4 } });
    for (const statement of queries().filter((value) => value.includes("GROUP BY n.kind") || value.includes("count(DISTINCT n.incident_id)"))) {
      expect(statement).toContain("n.recipient_id =");
      expect(statement).toContain("n.read_at IS NULL");
      expect(statement).toContain("i.created_by_id =");
      expect(statement).toContain("i.assigned_to_id =");
    }
  });
  it("marks only own same-site unread record, with actor audit and no remote send", async () => {
    expect(await markEpdrNotificationRead({ notificationId: 8 })).toEqual({ success: true });
    const update = mocks.execute.mock.calls.find(([q]) => text(q).startsWith("UPDATE"))![0];
    expect(compile(update).params).toEqual([8, 2, 4, true, 4, 4]);
    expect(text(update)).toContain("n.read_at IS NULL");
    const audit = mocks.execute.mock.calls.find(([q]) => text(q).startsWith("INSERT"))![0];
    expect(compile(audit).params).toEqual([2, 4, 30, 10]);
  });
  it("does not audit another user's, another site's, or already-read notification", async () => {
    const impl = mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation((q: SQL) => text(q).startsWith("UPDATE") ? Promise.resolve({ rows: [] }) : impl(q));
    expect(await markEpdrNotificationRead({ notificationId: 8 })).toEqual({ success: true });
    expect(queries().some((s) => s.startsWith("INSERT"))).toBe(false);
  });
  it.each([
    { name: "reassigned non-creator", creator: 9, assignee: 8, role: "staff", membership: "staff", visible: false },
    { name: "creator after reassignment", creator: 4, assignee: 8, role: "staff", membership: "staff", visible: true },
    { name: "current assignee", creator: 9, assignee: 4, role: "staff", membership: "staff", visible: true },
    { name: "current site admin", creator: 9, assignee: 8, role: "staff", membership: "admin", visible: true },
    { name: "global admin demoted in site", creator: 9, assignee: 8, role: "admin", membership: "staff", visible: false },
    { name: "current superadmin", creator: 9, assignee: 8, role: "superadmin", membership: "staff", visible: true },
  ])("applies current Incident visibility to inbox, count and mark-read: $name", async (scenario) => {
    // A stale privileged session must not override current database roles.
    mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 2, session: { userId: 4, role: "superadmin" } });
    dbRole = scenario.role; siteRole = scenario.membership;
    const impl = mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation(async (q: SQL) => {
      const { sql: statement, params } = compile(q);
      if (statement.includes("SELECT n.id") || statement.includes("SELECT count") || statement.trimStart().startsWith("UPDATE")) {
        expect(statement).toContain("i.created_by_id =");
        expect(statement).toContain("i.assigned_to_id =");
        const [admin, creatorId, assigneeId] = params.slice(-3);
        expect(admin).toBe(scenario.role === "superadmin" || scenario.membership === "admin");
        const visible = admin === true || creatorId === scenario.creator || assigneeId === scenario.assignee;
        if (statement.includes("SELECT count")) return { rows: [{ count: visible ? 1 : 0 }] };
        if (statement.includes("SELECT n.id")) return { rows: visible ? [{ id: 8, incident_id: 30, kind: "assigned", created_at: new Date(0), read_at: null }] : [] };
        return { rows: visible ? [{ incident_id: 30, outbox_id: 10 }] : [] };
      }
      return impl(q);
    });
    const inbox = await getEpdrNotificationInbox();
    expect(inbox).toMatchObject({ notifications: scenario.visible ? [{ id: 8 }] : [], unreadCount: scenario.visible ? 1 : 0 });
    expect(await markEpdrNotificationRead({ notificationId: 8 })).toEqual({ success: true });
    expect(queries().some((s) => s.startsWith("INSERT"))).toBe(scenario.visible);
    const checks = queries().filter((s) => s.includes("SELECT u.role"));
    expect(checks).toHaveLength(2);
    expect(checks.every((s) => s.includes("u.is_active = true") && s.includes("s.is_active = true") && s.includes("FOR SHARE"))).toBe(true);
  });

  it("rejects revoked membership for mark-read before mutation", async () => {
    dbRole = "staff";
    const impl = mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation((q: SQL) => text(q).includes("FROM user_sites") ? Promise.resolve({ rows: [] }) : impl(q));
    expect(await getEpdrNotificationInbox()).toHaveProperty("message");
    expect(await markEpdrNotificationRead({ notificationId: 8 })).toHaveProperty("message");
    expect(queries().some((s) => /^(INSERT|UPDATE)/.test(s))).toBe(false);
  });

  it.each([null, { notificationId: 0 }, { notificationId: 1, userId: 9 }, { notificationId: "1" }])("rejects invalid read requests %#", async (input) => {
    expect(await markEpdrNotificationRead(input)).toEqual({ message: "Invalid notification." });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
