import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAdminAction: mocks.auth }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
import { saveRoomLayout } from "./room-layout";
import { devices, locations, racks } from "@/db/schema";

function persistence(revision = 0) {
    const updates: { table: unknown; patch: Record<string, unknown> }[] = [];
    const tx = {
        select: () => {
            let table: unknown;
            const rows = () => table === locations ? [{ id: 1, layoutRevision: revision }] : table === racks ? [{ id: 2, totalU: 42, floorX: null, floorZ: null, floorRotation: null }] : [];
            const chain = { from: (target: unknown) => { table = target; return chain; }, where: () => chain, orderBy: () => chain, for: async () => rows(), then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows()).then(resolve) };
            return chain;
        },
        update: (table: unknown) => ({ set: (patch: Record<string, unknown>) => ({ where: async () => { updates.push({ table, patch }); } }) }),
    };
    mocks.transaction.mockImplementation((callback: (tx: unknown) => Promise<void>) => callback(tx));
    return updates;
}
const input = { siteId: 1, roomId: 1, revision: 0, width: 10, depth: 8, height: 3, acknowledgeEstimated: true, assets: [{ key: "rack:2", x: 2, z: 2, rotation: 90 }] };

beforeEach(() => vi.clearAllMocks());
describe("room layout authorization boundary", () => {
    it("persists room dimensions and only floor placement without touching devices or audit data", async () => {
        mocks.auth.mockResolvedValue({ ok: true, activeSiteId: 1 });
        const updates = persistence();
        expect(await saveRoomLayout(input)).toMatchObject({ success: true });
        expect(updates.find((u) => u.table === racks)?.patch).toEqual({ floorX: 2, floorZ: 2, floorRotation: 90 });
        expect(updates.find((u) => u.table === locations)?.patch).toMatchObject({ roomWidthM: 10, roomDepthM: 8, roomHeightM: 3, layoutMode: "manual", layoutRevision: 1 });
        expect(updates.some((u) => u.table === devices)).toBe(false);
    });
    it("refuses stale revision and changed asset membership before any update", async () => {
        mocks.auth.mockResolvedValue({ ok: true, activeSiteId: 1 });
        let updates = persistence(1);
        expect(await saveRoomLayout(input)).toMatchObject({ success: false });
        expect(updates).toEqual([]);
        updates = persistence();
        expect(await saveRoomLayout({ ...input, assets: [] })).toMatchObject({ success: false });
        expect(updates).toEqual([]);
    });
    it("rejects non-admin requests before opening a transaction", async () => {
        mocks.auth.mockResolvedValue({ ok: false, message: "Unauthorized" });
        expect(await saveRoomLayout({})).toMatchObject({ success: false, message: "Unauthorized" });
        expect(mocks.transaction).not.toHaveBeenCalled();
    });
    it("rejects a stale active site and malformed room size", async () => {
        mocks.auth.mockResolvedValue({ ok: true, activeSiteId: 1 });
        const input = { siteId: 2, roomId: 1, revision: 0, width: 10, depth: 8, height: 3, assets: [] };
        expect(await saveRoomLayout(input)).toMatchObject({ success: false });
        expect(await saveRoomLayout({ ...input, siteId: 1, width: -10 })).toMatchObject({ success: false });
        expect(mocks.transaction).not.toHaveBeenCalled();
    });
});
