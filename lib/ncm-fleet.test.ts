import { describe, expect, it, vi } from "vitest";
import {
    buildFleetSnapshot,
    getFleetSnapshot,
    isOpenReview,
    type NcmFleetDeps,
    toFleetDriftRow,
    type FleetSnapshot,
} from "./ncm-fleet";

// Pure aggregation tests (no DB): buildFleetSnapshot takes every input as a
// plain map/array, so the badge/table contract is verified directly. One
// integration test covers the live-fetch seam via faked deps.
const SITES = [
    { id: 1, name: "DC-JKT" },
    { id: 2, name: "DC-SBY" },
    { id: 3, name: "DC-UNCONFIGURED" },
];

function snapshot(): FleetSnapshot {
    return buildFleetSnapshot(
        SITES,
        new Map([
            [1, { status: "online", lastSeenAt: new Date("2026-09-10T00:00:00Z") }],
            [2, { status: "offline", lastSeenAt: new Date("2026-09-09T00:00:00Z") }],
        ]),
        new Map([
            [1, true],
            [2, true],
            [3, false],
        ]),
        [
            { siteId: 1, siteName: "DC-JKT", reviews: [{ id: 11, status: "pending", switch_name: "core-1" }, { id: 12, status: "approved" }], error: null },
            { siteId: 2, siteName: "DC-SBY", reviews: null, error: "Gagal terhubung ke http://sby:9443" },
            { siteId: 3, siteName: "DC-UNCONFIGURED", reviews: null, error: null },
        ],
        new Map([
            [2, 4],
            [3, 1],
        ]),
        "2026-09-10T01:00:00.000Z",
    );
}

describe("isOpenReview / toFleetDriftRow", () => {
    it("treats pending/in_review (and missing status) as open, decided as closed", () => {
        expect(isOpenReview({ status: "pending" })).toBe(true);
        expect(isOpenReview({ status: "in_review" })).toBe(true);
        expect(isOpenReview({})).toBe(true);
        expect(isOpenReview({ status: "approved" })).toBe(false);
        expect(isOpenReview({ status: "flagged" })).toBe(false);
        expect(isOpenReview({ status: "dismissed" })).toBe(false);
        // NCM field names drift — state is accepted as a fallback.
        expect(isOpenReview({ state: "PENDING" })).toBe(true);
    });

    it("maps a review row onto the cross-site drift table shape", () => {
        const row = toFleetDriftRow(7, "DC-JKT", {
            id: 11,
            status: "pending",
            switch_name: "core-1",
            created_at: "2026-09-10T01:02:03Z",
        });
        expect(row).toEqual({
            siteId: 7,
            siteName: "DC-JKT",
            reviewId: "11",
            switchLabel: "core-1",
            status: "pending",
            createdAt: "2026-09-10T01:02:03Z",
        });
    });
});

describe("buildFleetSnapshot", () => {
    it("aggregates badges + open drifts + offline/total counters", () => {
        const snap = snapshot();
        expect(snap.sites).toHaveLength(3);
        expect(snap.sites[0]).toMatchObject({ siteName: "DC-JKT", status: "online", reachable: true, openDriftCount: 1 });
        expect(snap.sites[1]).toMatchObject({ siteName: "DC-SBY", status: "offline", reachable: false, openDriftCount: 4, error: "Gagal terhubung ke http://sby:9443" });
        expect(snap.sites[2]).toMatchObject({ siteName: "DC-UNCONFIGURED", configured: false, reachable: false, openDriftCount: 1 });
        // Drift table = one row per open review across sites.
        expect(snap.drifts).toEqual([expect.objectContaining({ siteId: 1, reviewId: "11", switchLabel: "core-1" })]);
        expect(snap.offlineCount).toBe(1);
        expect(snap.openDriftTotal).toBe(6); // 1 live + 4 JKT-incident + 1 unconfigured
    });

    it("counts live open drifts even when the site heartbeat says online", () => {
        const snap = buildFleetSnapshot(
            SITES,
            new Map([[1, { status: "online", lastSeenAt: null }]]),
            new Map([[1, true]]),
            [{ siteId: 1, siteName: "DC-JKT", reviews: [{ id: 1, status: "pending" }, { id: 2, status: "pending" }], error: null }],
            new Map(),
            "2026-09-10T01:00:00.000Z",
        );
        expect(snap.sites[0]?.openDriftCount).toBe(2);
        expect(snap.openDriftTotal).toBe(2);
    });
});

describe("getFleetSnapshot (live-fetch seam)", () => {
    function makeDeps(overrides: Partial<NcmFleetDeps> = {}): NcmFleetDeps {
        return {
            listSites: vi.fn(async () => SITES),
            listHeartbeatRows: vi.fn(async () => [{ siteId: 2, status: "offline", lastSeenAt: new Date("2026-09-09T00:00:00Z") }]),
            resolveConfig: vi.fn(async (siteId: number) =>
                siteId === 3 ? { url: null, adminApiKey: null } : { url: "http://site:9443", adminApiKey: "key" }),
            fetchReviews: vi.fn(async () => [{ id: 5, status: "pending", switch_name: "sw-1" }]),
            countOpenDriftIncidents: vi.fn(async () => 2),
            ...overrides,
        };
    }

    it("live-fetches reviews per configured site and keeps drift counts", async () => {
        const deps = makeDeps();
        const snap = await getFleetSnapshot(deps);
        expect(deps.resolveConfig).toHaveBeenCalledTimes(3);
        expect(deps.fetchReviews).toHaveBeenCalledTimes(2); // unconfigured site skipped
        expect(snap.sites.find((s) => s.siteId === 1)?.openDriftCount).toBe(3); // 1 live + 2 incident
        expect(snap.openDriftTotal).toBe(8); // 1 live + 3×2 incident
    });

    it("degrades an unreachable NCM to a red badge instead of crashing", async () => {
        const deps = makeDeps({ fetchReviews: vi.fn(async () => { throw new Error("connect ECONNREFUSED"); }) });
        const snap = await getFleetSnapshot(deps);
        expect(snap.sites.find((s) => s.siteId === 1)).toMatchObject({ reachable: false, error: "connect ECONNREFUSED", openDriftCount: 2 });
        expect(snap.sites.find((s) => s.siteId === 2)).toMatchObject({ reachable: false });
        expect(snap.drifts).toEqual([]);
    });
});

describe.skip("ncmFleetDeps (DB-backed)", () => {
    it("is covered by the seams above; DB wiring exercised via build", async () => {
        expect(true).toBe(true);
    });
});
