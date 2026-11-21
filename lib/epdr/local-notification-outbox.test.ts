import { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), tx: vi.fn(), transaction: vi.fn(), rollback: vi.fn() }));
vi.mock("@/db", () => ({ db: { execute: mocks.execute, transaction: mocks.transaction } }));
import { processLocalNotificationQueue, scheduleLocalNotifications } from "./local-notification-outbox";
const dialect = new PgDialect();
const compile = (q: SQL) => dialect.sqlToQuery(q);
const text = (q: SQL) => compile(q).sql.replace(/\s+/g, " ").trim();
const queries = () => mocks.tx.mock.calls.map(([q]) => text(q));
const claim = { id: 10, site_id: 2, incident_id: 30, recipient_id: 4, kind: "assigned", lease_token: "new-token" };
let revoked: string | null;
let overdue: boolean;
let quietStart: number | null;
let quietEnd: number | null;
let escalate: boolean;
let digest: boolean;
let digestHour: number | null;
let unread: number;
let timeZone: string;
let digestDay: string;
beforeEach(() => {
  vi.resetAllMocks(); timeZone = "UTC"; digestDay = "2030-01-01"; revoked = null; overdue = true; quietStart = null; quietEnd = null; escalate = false; digest = false; digestHour = null; unread = 2;
  mocks.transaction.mockImplementation(async (callback) => {
    try { return await callback({ execute: mocks.tx }); }
    catch (error) { mocks.rollback(); throw error; }
  });
  mocks.execute.mockImplementation(async (q: SQL) => ({ rows: text(q).includes("RETURNING o.*") ? [{ ...claim, digest_day: digestDay }] : [] }));
  mocks.tx.mockImplementation(async (q: SQL) => {
    const s = text(q);
    if (revoked && s.includes(revoked)) return { rows: [] };
    if (s.includes("SELECT p.site_id")) return { rows: [{ site_id: 2, escalate_overdue_to_admins: escalate, digest_enabled: digest, digest_hour_utc: digestHour }] };
    if (s.includes("SELECT p.notify_held")) return { rows: [{ notify_held: false, quiet_start: quietStart, quiet_end: quietEnd, digest_enabled: digest, time_zone: timeZone, digest_hour_utc: digestHour ?? 0, escalate_overdue_to_admins: true }] };
    if (s.includes("SELECT clock_timestamp() AS now")) return { rows: [{ now: new Date("2030-01-01T23:30:00Z") }] };
    if (s.includes("SELECT automation_hold")) return { rows: [{ automation_hold: false, due_date: new Date("2030-01-01"), overdue, assigned_to_id: 4 }] };
    if (s.includes("SELECT u.id")) return { rows: [{ id: 4, role_in_site: "admin" }] };
    if (s.includes("SELECT id FROM epdr_local_notification_outbox")) return { rows: [{ id: 4 }] };
    if (s.includes("FROM epdr_local_notifications") && s.includes("kind <> 'digest'")) return { rows: [{ count: unread }] };
    if (s.includes("RETURNING status")) return { rows: [{ status: "queued" }] };
    return { rows: [] };
  });
});

describe("local notification scheduling", () => {
  it("does nothing without explicit active-site policy", async () => {
    revoked = "SELECT p.site_id";
    await scheduleLocalNotifications(2);
    expect(queries()).toHaveLength(1);
  });
  it("queues opt-in SLA escalation to active site admins, excluding the assignee", async () => {
    escalate = true;
    await scheduleLocalNotifications(2);
    const escalation = queries().find((s) => s.includes("'sla_escalation'"))!;
    expect(escalation).toContain("m.role_in_site = 'admin'");
    expect(escalation).toContain("i.due_date <= clock_timestamp()");
    expect(escalation).toContain("m.user_id <> coalesce(i.assigned_to_id, -1)");
    expect(escalation).toContain("ON CONFLICT (incident_id, recipient_id, kind) DO NOTHING");
  });
  it("queues one digest per recipient per policy-local day when the digest hour has passed", async () => {
    digest = true; digestHour = 0;
    await scheduleLocalNotifications(2);
    const insert = queries().find((s) => s.includes("'digest'") && s.includes("digest_day"))!;
    expect(insert).toContain("(clock_timestamp() AT TIME ZONE p.time_zone)::date");
    expect(insert).toContain("extract(hour FROM clock_timestamp() AT TIME ZONE p.time_zone) >= p.digest_hour_utc");
    expect(insert).toContain("n.kind <> 'digest'");
    expect(insert).toContain("GROUP BY n.recipient_id");
    expect(insert).toContain("ON CONFLICT DO NOTHING");
  });
  it("does not queue digests when disabled or without an hour", async () => {
    await scheduleLocalNotifications(2);
    expect(queries().some((s) => s.includes("'digest'") && s.includes("digest_day"))).toBe(false);
  });
  it("does not queue SLA escalation when the policy flag is off", async () => {
    await scheduleLocalNotifications(2);
    expect(queries().some((s) => s.includes("'sla_escalation'"))).toBe(false);
  });
  it("schedules durable deduplicated assignment and deadline rows, excluding held incidents by default", async () => {
    await scheduleLocalNotifications(2);
    const query = queries()[1];
    expect(query).toContain("ON CONFLICT (incident_id, recipient_id, kind) DO NOTHING");
    expect(query).toContain("THEN i.due_date");
    expect(query).toContain("i.automation_hold = false OR p.notify_held = true");
    expect(query).toContain("m.site_id = i.site_id");
    expect(query).toContain("i.source = 'epdr_manual'");
    expect(compile(mocks.tx.mock.calls[1][0]).params).toContain(2);
  });
});

describe("leased local publication", () => {
  it("revalidates the current scheduling zone for queued notices", async () => {
    timeZone = "America/New_York"; quietStart = 18; quietEnd = 20;
    await processLocalNotificationQueue();
    const update = mocks.tx.mock.calls.find(([q]) => text(q).startsWith("UPDATE epdr_local_notification_outbox"))![0];
    expect(compile(update).params).toContainEqual(new Date("2030-01-02T01:00:00Z"));
    expect(queries().some((s) => s.includes("INSERT INTO epdr_local_notifications"))).toBe(false);
  });
  it("cancels a stale digest local date after a policy zone change", async () => {
    digest = true; timeZone = "Asia/Jakarta";
    mocks.execute.mockImplementation(async (q: SQL) => ({ rows: text(q).includes("RETURNING o.*") ? [{ ...claim, kind: "digest", incident_id: null, digest_day: "2030-01-01" }] : [] }));
    await processLocalNotificationQueue();
    expect(queries().some((s) => s.includes("eligibility_revoked"))).toBe(true);
    expect(queries().some((s) => s.includes("INSERT INTO epdr_local_notifications"))).toBe(false);
  });
  it("does not publish a queued digest before the changed digest hour", async () => {
    digest = true; digestHour = 23; timeZone = "America/New_York";
    mocks.execute.mockImplementation(async (q: SQL) => ({ rows: text(q).includes("RETURNING o.*") ? [{ ...claim, kind: "digest", incident_id: null, digest_day: "2030-01-01" }] : [] }));
    await processLocalNotificationQueue();
    expect(queries().some((s) => s.includes("attempts = attempts - 1"))).toBe(true);
    expect(queries().some((s) => s.includes("INSERT INTO epdr_local_notifications"))).toBe(false);
  });
  it("claims with SKIP LOCKED, expiry fencing and bounded attempts", async () => {
    await processLocalNotificationQueue();
    const claimSql = text(mocks.execute.mock.calls[1][0]);
    expect(claimSql).toContain("FOR UPDATE SKIP LOCKED LIMIT 1");
    expect(claimSql).toContain("attempts < 5");
    expect(claimSql).toContain("gen_random_uuid()");
    expect(text(mocks.execute.mock.calls[0][0])).toContain("attempts >= 5");
    expect(queries().find((s) => s.includes("SELECT id FROM epdr_local_notification_outbox"))).toContain("lease_until > clock_timestamp()");
    expect(queries().find((s) => s.includes("INSERT INTO epdr_local_notifications"))).toContain("ON CONFLICT (outbox_id) DO NOTHING");
    expect(queries().some((s) => s.includes("'delivered'"))).toBe(true);
    expect(queries().filter((s) => s.startsWith("UPDATE incidents"))).toEqual([]);
  });
  it.each(["SELECT p.notify_held", "SELECT automation_hold", "SELECT u.id"])("cancels revoked eligibility %s without publication", async (fragment) => {
    revoked = fragment;
    await processLocalNotificationQueue();
    expect(queries().some((s) => s.includes("INSERT INTO epdr_local_notifications"))).toBe(false);
    expect(queries().some((s) => s.includes("eligibility_revoked"))).toBe(true);
  });
  it("does not publish or finalize a stale lease", async () => {
    revoked = "SELECT id FROM epdr_local_notification_outbox";
    await processLocalNotificationQueue();
    expect(queries().filter((s) => /^(INSERT|UPDATE)/.test(s))).toEqual([]);
  });
  it("postpones an extended SLA deadline without consuming an attempt", async () => {
    mocks.execute.mockImplementation(async (q: SQL) => ({ rows: text(q).includes("RETURNING o.*") ? [{ ...claim, kind: "overdue" }] : [] }));
    overdue = false;
    await processLocalNotificationQueue();
    expect(queries().some((s) => s.includes("attempts = attempts - 1"))).toBe(true);
    expect(queries().some((s) => s.includes("INSERT INTO epdr_local_notifications"))).toBe(false);
  });
  it("defers using the locked current policy and database clock without spending an attempt", async () => {
    quietStart = 22; quietEnd = 7;
    await processLocalNotificationQueue();
    const policy = queries().find((s) => s.includes("SELECT p.notify_held"))!;
    expect(policy).toContain("p.quiet_start, p.quiet_end");
    expect(policy).toContain("FOR SHARE OF p, s");
    const update = mocks.tx.mock.calls.find(([q]) => text(q).startsWith("UPDATE epdr_local_notification_outbox"))![0];
    expect(text(update)).toContain("status = 'queued'");
    expect(text(update)).toContain("attempts = attempts - 1");
    expect(compile(update).params).toContainEqual(new Date("2030-01-02T07:00:00Z"));
    expect(queries().some((s) => s.includes("INSERT INTO epdr_local_notifications"))).toBe(false);
    expect(queries().some((s) => s.includes("INSERT INTO epdr_local_notification_audit"))).toBe(false);
    // Requeued quiet rows are not eligible until their future availability; terminal rows never qualify.
    const claimSql = text(mocks.execute.mock.calls[1][0]);
    expect(claimSql).toContain("status = 'queued' AND available_at <= clock_timestamp()");
    expect(claimSql).not.toMatch(/status = '(delivered|cancelled|failed)'/);
  });
  it.each([["admin", true], ["staff", false]])("revalidates current admin role for SLA escalation (%s)", async (role, delivered) => {
    mocks.execute.mockImplementation(async (q: SQL) => ({ rows: text(q).includes("RETURNING o.*") ? [{ ...claim, kind: "sla_escalation" }] : [] }));
    const implementation = mocks.tx.getMockImplementation()!;
    mocks.tx.mockImplementation(async (q: SQL) => {
      if (text(q).includes("SELECT u.id")) return { rows: [{ id: 4, role_in_site: role }] };
      return implementation(q);
    });
    await processLocalNotificationQueue();
    expect(queries().some((s) => s.includes("INSERT INTO epdr_local_notifications"))).toBe(delivered);
    if (!delivered) expect(queries().some((s) => s.includes("eligibility_revoked"))).toBe(true);
  });
  it("delivers a digest only while unread notices remain and the policy is enabled", async () => {
    digest = true; unread = 2;
    mocks.execute.mockImplementation(async (q: SQL) => ({ rows: text(q).includes("RETURNING o.*") ? [{ ...claim, kind: "digest", incident_id: null, digest_day: digestDay }] : [] }));
    await processLocalNotificationQueue();
    expect(queries().some((s) => s.includes("kind <> 'digest'"))).toBe(true);
    const insert = mocks.tx.mock.calls.find(([q]) => text(q).includes("INSERT INTO epdr_local_notifications"))![0];
    expect(compile(insert).params[2]).toBeNull();
    expect(queries().some((s) => s.includes("'delivered'"))).toBe(true);
  });
  it("cancels an empty or disabled digest without publishing", async () => {
    digest = true; unread = 0;
    mocks.execute.mockImplementation(async (q: SQL) => ({ rows: text(q).includes("RETURNING o.*") ? [{ ...claim, kind: "digest", incident_id: null, digest_day: digestDay }] : [] }));
    await processLocalNotificationQueue();
    expect(queries().some((s) => s.includes("eligibility_revoked"))).toBe(true);
    expect(queries().some((s) => s.includes("INSERT INTO epdr_local_notifications"))).toBe(false);
    digest = false; unread = 2;
    await processLocalNotificationQueue();
    expect(queries().filter((s) => s.includes("eligibility_revoked"))).toHaveLength(2);
  });
  it("requeues a digest during quiet hours without spending an attempt", async () => {
    digest = true; unread = 1; quietStart = 22; quietEnd = 7;
    mocks.execute.mockImplementation(async (q: SQL) => ({ rows: text(q).includes("RETURNING o.*") ? [{ ...claim, kind: "digest", incident_id: null, digest_day: digestDay }] : [] }));
    await processLocalNotificationQueue();
    expect(queries().some((s) => s.includes("INSERT INTO epdr_local_notifications"))).toBe(false);
    const requeue = mocks.tx.mock.calls.find(([q]) => text(q).startsWith("UPDATE epdr_local_notification_outbox"))![0];
    expect(text(requeue)).toContain("attempts = attempts - 1");
    expect(compile(requeue).params).toContainEqual(new Date("2030-01-02T07:00:00Z"));
  });
  it("publishes when the current quiet window no longer covers delivery time", async () => {
    quietStart = 10; quietEnd = 15;
    await processLocalNotificationQueue();
    expect(queries().some((s) => s.includes("INSERT INTO epdr_local_notifications"))).toBe(true);
  });
  it("still cancels revoked recipients during quiet hours rather than replaying them", async () => {
    quietStart = 22; quietEnd = 7; revoked = "SELECT u.id";
    await processLocalNotificationQueue();
    expect(queries().some((s) => s.includes("eligibility_revoked"))).toBe(true);
    expect(queries().some((s) => s.includes("attempts = attempts - 1"))).toBe(false);
  });
  it("rolls back publication on audit failure then retries with a fence and cap", async () => {
    const implementation = mocks.tx.getMockImplementation()!;
    let fail = true;
    mocks.tx.mockImplementation(async (q: SQL) => {
      if (fail && text(q).includes("INSERT INTO epdr_local_notification_audit")) { fail = false; throw new Error("synthetic"); }
      return implementation(q);
    });
    await processLocalNotificationQueue();
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    const retry = queries().find((s) => s.includes("RETURNING status"))!;
    expect(retry).toContain("attempts >= 5");
    expect(retry).toContain("lease_token =");
    expect(retry).toContain("lease_until > clock_timestamp()");
  });
  it("revalidates exact tenant, current assignee and active recipient with revocation locks", async () => {
    await processLocalNotificationQueue();
    const incidentQuery = mocks.tx.mock.calls.find(([q]) => text(q).includes("SELECT automation_hold"))![0];
    expect(compile(incidentQuery).params).toEqual([30, 2]);
    expect(text(incidentQuery)).toContain("FOR SHARE");
    const recipientQuery = mocks.tx.mock.calls.find(([q]) => text(q).includes("SELECT u.id"))![0];
    expect(compile(recipientQuery).params).toEqual([2, 4]);
    expect(text(recipientQuery)).toContain("FOR SHARE OF u, m");
  });
});
