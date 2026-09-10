import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    buildNcmHeartbeatTelegramMessage,
    checkNcmSite,
    NCM_OFFLINE_THRESHOLD,
    runHeartbeatAllSites,
    type NcmHeartbeatDeps,
    type NcmHeartbeatNotifyEvent,
    type NcmHeartbeatOutcome,
} from "./ncm-heartbeat";

// Pure deps fakes — same shape as the ncm-ingest tests. A tiny in-memory
// store stands in for the ncm_settings row + open incident.
function makeDeps(overrides: Partial<NcmHeartbeatDeps> = {}) {
    const calls = {
        pings: 0,
        touches: 0,
        rows: [] as { status: "online" | "offline"; missCount: number; lastSeenAt?: Date }[],
        incidents: [] as { siteId: number; deviceId: number; title: string; severity: string }[],
        updates: [] as { incidentId: number; note: string; newStatus: string }[],
        resolved: [] as { incidentId: number; note: string }[],
        notifies: [] as NcmHeartbeatNotifyEvent[],
    };

    let row: { status: "online" | "offline"; missCount: number; lastSeenAt?: Date | null } | null = null;
    let openIncident: { id: number; title: string } | null = null;
    let nextIncidentId = 101;

    const deps: NcmHeartbeatDeps = {
        resolveNcmConfig: vi.fn(async () => ({ url: "http://10.0.0.9:9443", adminApiKey: "k" })),
        pingNcm: vi.fn(async () => {
            calls.pings++;
            return [];
        }),
        touchNcmLastSeen: vi.fn(async () => {
            calls.touches++;
        }),
        getHeartbeatRow: vi.fn(async () => row),
        setHeartbeatRow: vi.fn(async (_siteId, values) => {
            // Preserve last_seen on misses like the real UPDATE (which only
            // writes the columns it is given).
            row = { ...row, status: values.status, missCount: values.missCount, ...(values.lastSeenAt ? { lastSeenAt: values.lastSeenAt } : {}) };
            calls.rows.push({ ...values });
        }),
        findDevicesBySite: vi.fn(async () => [{ id: 55, name: "SW-CORE-01" }]),
        findOpenOfflineIncident: vi.fn(async () => openIncident),
        insertIncident: vi.fn(async (values) => {
            calls.incidents.push({ ...values });
            const created = { id: nextIncidentId++, title: values.title };
            openIncident = created;
            return created;
        }),
        insertIncidentUpdate: vi.fn(async (values) => {
            calls.updates.push({ ...values });
        }),
        resolveIncident: vi.fn(async (incidentId, note) => {
            calls.resolved.push({ incidentId, note });
            openIncident = null;
        }),
        notifyEvent: vi.fn(async (event: NcmHeartbeatNotifyEvent) => {
            calls.notifies.push({ ...event });
        }),
        ...overrides,
    };
    return { deps, calls, getRow: () => row, setRow: (next: { status: "online" | "offline"; missCount: number; lastSeenAt?: Date | null } | null) => { row = next; } };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("checkNcmSite (ticket 09)", () => {
    it("success: pings, touches last_seen, resets miss streak, stays online", async () => {
        const { deps, calls, getRow, setRow } = makeDeps();
        setRow({ status: "online", missCount: 2 }); // a stale failure streak before the success

        const outcome = await checkNcmSite(deps, { siteId: 1, siteName: "HQ" });

        expect(outcome).toMatchObject({ configured: true, ok: true, status: "online", missCount: 0, incidentId: null });
        expect(calls.pings).toBe(1);
        expect(calls.touches).toBe(1);
        expect(getRow()).toMatchObject({ status: "online", missCount: 0 });
        expect(calls.incidents).toHaveLength(0);
    });

    it("unconfigured site: no ping, nothing written", async () => {
        const { deps, calls } = makeDeps({
            resolveNcmConfig: vi.fn(async () => ({ url: null, adminApiKey: null })),
        });

        const outcome = await checkNcmSite(deps, { siteId: 1, siteName: "HQ" });

        expect(outcome).toMatchObject({ configured: false, ok: false, status: null });
        expect(calls.pings).toBe(0);
        expect(calls.rows).toHaveLength(0);
    });

    it("failures below threshold: miss streak grows, status stays online, no incident", async () => {
        const { deps, calls, getRow } = makeDeps({ pingNcm: vi.fn(async () => { throw new Error("fetch failed"); }) });

        const first = await checkNcmSite(deps, { siteId: 1, siteName: "HQ" });
        const second = await checkNcmSite(deps, { siteId: 1, siteName: "HQ" });

        expect(first).toMatchObject({ ok: false, status: "online", missCount: 1, incidentId: null });
        expect(second).toMatchObject({ ok: false, status: "online", missCount: 2, incidentId: null });
        expect(calls.touches).toBe(0);
        expect(calls.incidents).toHaveLength(0);
        expect(getRow()).toMatchObject({ status: "online", missCount: 2 });
    });

    it(`reaching ${NCM_OFFLINE_THRESHOLD} consecutive misses: flips OFFLINE + files one High incident (dedupe on repeat)`, async () => {
        const { deps, calls } = makeDeps({ pingNcm: vi.fn(async () => { throw new Error("timeout"); }) });

        await checkNcmSite(deps, { siteId: 1, siteName: "HQ" });
        await checkNcmSite(deps, { siteId: 1, siteName: "HQ" });
        const third = await checkNcmSite(deps, { siteId: 1, siteName: "HQ" });
        const fourth = await checkNcmSite(deps, { siteId: 1, siteName: "HQ" });

        expect(third).toMatchObject({ ok: false, status: "offline", missCount: NCM_OFFLINE_THRESHOLD, incidentId: 101, incidentCreated: true });
        expect(calls.incidents).toHaveLength(1);
        expect(calls.incidents[0]).toMatchObject({ siteId: 1, deviceId: 55, severity: "High", title: "Site NCM offline: HQ" });
        expect(calls.updates).toHaveLength(1);
        // 4th miss: still offline, no second incident.
        expect(fourth).toMatchObject({ status: "offline", missCount: 4, incidentId: null, incidentCreated: false });
        expect(calls.incidents).toHaveLength(1);
    });

    it("already-offline + pre-existing open incident: miss never re-files", async () => {
        const { deps, calls } = makeDeps({
            pingNcm: vi.fn(async () => { throw new Error("timeout"); }),
            findOpenOfflineIncident: vi.fn(async () => ({ id: 77, title: "Site NCM offline: HQ" })),
            getHeartbeatRow: vi.fn(async () => ({ status: "offline" as const, missCount: 0 })),
        });

        const outcome = await checkNcmSite(deps, { siteId: 1, siteName: "HQ" });

        expect(outcome).toMatchObject({ status: "offline", incidentId: null, incidentCreated: false });
        expect(calls.incidents).toHaveLength(0);
    });

    it("offline site with no devices: goes offline but files no incident (device_id NOT NULL contract)", async () => {
        const { deps, calls } = makeDeps({
            pingNcm: vi.fn(async () => { throw new Error("timeout"); }),
            findDevicesBySite: vi.fn(async () => []),
        });

        for (let i = 0; i < NCM_OFFLINE_THRESHOLD; i++) {
            await checkNcmSite(deps, { siteId: 1, siteName: "HQ" });
        }

        expect(calls.incidents).toHaveLength(0);
    });

    it("recovery: a success after OFFLINE resolves the open incident and returns online", async () => {
        // Offline row with an open incident #77 (simulate by wiring the dep
        // row + hooking the fake defaulter).
        const { deps, calls, getRow, setRow } = makeDeps({
            findOpenOfflineIncident: vi.fn(async () => ({ id: 77, title: "Site NCM offline: HQ" })),
        });
        setRow({ status: "offline", missCount: 5 });

        const outcome = await checkNcmSite(deps, { siteId: 1, siteName: "HQ" });

        expect(outcome).toMatchObject({ ok: true, status: "online", missCount: 0 });
        expect(calls.touches).toBe(1);
        expect(calls.resolved).toEqual([{ incidentId: 77, note: expect.stringContaining("Auto-resolved") }]);
        expect(getRow()).toMatchObject({ status: "online", missCount: 0 });
    });

    it("recovery with no open incident: last_seen still stamps, nothing resolved", async () => {
        const { deps, calls } = makeDeps();
        // Row still says offline but the incident was closed manually.
        // getHeartbeatRow returns offline; findOpenOfflineIncident returns null.
        // Simulate via overrides below.
        const { deps: d2, calls: c2 } = makeDeps({
            pingNcm: vi.fn(async () => []),
            findOpenOfflineIncident: vi.fn(async () => null),
        });
        void deps; void calls;

        const outcome = await checkNcmSite(d2, { siteId: 1, siteName: "HQ" });
        // Row defaults to null → wasOffline false → no resolve call, still online.
        expect(outcome).toMatchObject({ ok: true, status: "online" });
        expect(c2.resolved).toHaveLength(0);
        expect(c2.touches).toBe(1);
    });

    it("runHeartbeatAllSites: collects per-site results, a crash does not kill the pass", async () => {
        const failing = makeDeps({ pingNcm: vi.fn(async () => { throw new Error("boom"); }) });
        const okDeps = makeDeps();
        // getHeartbeatRow crash simulates an unexpected error inside checkNcmSite
        const crashing = makeDeps({ getHeartbeatRow: vi.fn(async () => { throw new Error("db down"); }) });

        const results = await runHeartbeatAllSites(failing.deps, { sites: [{ id: 1, name: "A" }] });
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({ siteId: 1, ok: false });

        const okResults = await runHeartbeatAllSites(okDeps.deps, { sites: [{ id: 2, name: "B" }] });
        expect(okResults).toHaveLength(1);
        expect(okResults[0]).toMatchObject({ ok: true });

        const crashed = await runHeartbeatAllSites(crashing.deps, { sites: [{ id: 3, name: "C" }] });
        expect(crashed).toHaveLength(0);
    });
});

describe("Telegram notify on transitions (ticket 11)", () => {
    const LAST_SEEN = new Date("2026-09-10T01:00:00Z");

    it("below threshold: none; offline transition: exactly one; repeat miss: none; recovery: one", async () => {
        let fail = true;
        const { deps, calls, setRow } = makeDeps({
            pingNcm: vi.fn(async () => {
                if (fail) throw new Error("timeout");
                return [];
            }),
        });
        setRow({ status: "online", missCount: 0, lastSeenAt: LAST_SEEN });

        await checkNcmSite(deps, { siteId: 1, siteName: "HQ" });
        await checkNcmSite(deps, { siteId: 1, siteName: "HQ" });
        expect(calls.notifies).toHaveLength(0);

        const third = await checkNcmSite(deps, { siteId: 1, siteName: "HQ" });
        expect(third).toMatchObject({ status: "offline", incidentCreated: true });
        expect(calls.notifies).toHaveLength(1);
        expect(calls.notifies[0]).toMatchObject({ siteId: 1, siteName: "HQ", kind: "offline", lastSeenAt: LAST_SEEN, error: "timeout" });

        await checkNcmSite(deps, { siteId: 1, siteName: "HQ" }); // 4th miss: still offline, still one
        expect(calls.notifies).toHaveLength(1);

        fail = false;
        const recovered = await checkNcmSite(deps, { siteId: 1, siteName: "HQ" });
        expect(recovered).toMatchObject({ ok: true, status: "online" });
        expect(calls.notifies).toHaveLength(2);
        expect(calls.notifies[1]).toMatchObject({ siteId: 1, siteName: "HQ", kind: "recovered", error: null });
    });

    it("recovery notif fires even when the open incident was already closed manually", async () => {
        const { deps, calls, setRow } = makeDeps({ findOpenOfflineIncident: vi.fn(async () => null) });
        setRow({ status: "offline", missCount: 5, lastSeenAt: LAST_SEEN });

        const outcome = await checkNcmSite(deps, { siteId: 1, siteName: "HQ" });

        expect(outcome).toMatchObject({ ok: true, status: "online" });
        expect(calls.resolved).toHaveLength(0);
        expect(calls.notifies).toHaveLength(1);
        expect(calls.notifies[0]).toMatchObject({ kind: "recovered" });
    });

    it("a failing notifier never fails the heartbeat itself", async () => {
        let fail = true;
        const { deps, calls } = makeDeps({
            pingNcm: vi.fn(async () => {
                if (fail) throw new Error("timeout");
                return [];
            }),
            notifyEvent: vi.fn(async () => {
                throw new Error("telegram down");
            }),
        });

        const outcomes: NcmHeartbeatOutcome[] = [];
        for (let i = 0; i < NCM_OFFLINE_THRESHOLD; i++) {
            outcomes.push(await checkNcmSite(deps, { siteId: 1, siteName: "HQ" }));
        }
        expect(outcomes[outcomes.length - 1]).toMatchObject({ status: "offline", incidentCreated: true, missCount: NCM_OFFLINE_THRESHOLD });
        expect(calls.incidents).toHaveLength(1); // incident still filed
        expect(calls.notifies).toHaveLength(0); // notifier rejected; nothing recorded

        fail = false;
        const recovered = await checkNcmSite(deps, { siteId: 1, siteName: "HQ" });
        expect(recovered).toMatchObject({ ok: true, status: "online", missCount: 0 });
        expect(calls.resolved).toHaveLength(1); // resolve still ran despite the notifier failure
    });

    it("buildNcmHeartbeatTelegramMessage: offline carries site/waktu/last_seen/error; recovered is the recovery note", () => {
        const offline = buildNcmHeartbeatTelegramMessage({
            siteId: 1,
            siteName: "HQ <b>",
            kind: "offline",
            occurredAt: new Date("2026-09-10T02:00:00Z"),
            lastSeenAt: LAST_SEEN,
            error: "fetch failed",
        });
        expect(offline).toContain("Site: HQ &lt;b&gt;");
        expect(offline).toContain("Waktu: 2026-09-10T02:00:00.000Z");
        expect(offline).toContain(`Terakhir terlihat: ${LAST_SEEN.toISOString()}`);
        expect(offline).toContain("Error terakhir: fetch failed");
        expect(offline).toContain("OFFLINE");

        const recovered = buildNcmHeartbeatTelegramMessage({
            siteId: 1,
            siteName: "HQ",
            kind: "recovered",
            occurredAt: new Date("2026-09-10T02:00:00Z"),
            lastSeenAt: null,
            error: null,
        });
        expect(recovered).toContain("Site: HQ");
        expect(recovered).toContain("pulih");
        expect(recovered).toContain("Waktu: 2026-09-10T02:00:00.000Z");
    });
});
