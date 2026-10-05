import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAdminAction: mocks.auth }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
import { convertFacilityDevice } from "./facility-assets";
import { devices, locations, categories } from "@/db/schema";

const original = { assetType: "standard" as const, categoryId: 1, locationId: 1, rackName: "UPS", rackPosition: 1, uHeight: 4 };
const payload = { siteId: 1, deviceId: 1, original, asset: { assetType: "ups", facilitySpecs: { subtype: "floor-standing", capacityKva: 20 }, locationId: 1, floorX: null, floorZ: null, floorRotation: null }, roomRevision: 0 };
function persistence(current: Record<string, unknown>, revision = 0, fail = false) {
    const row = { ...current };
    const updates: { table: unknown; patch: Record<string, unknown> }[] = [];
    const tx = {
        select: () => {
            let table: unknown;
            const chain = { from: (target: unknown) => { table = target; return chain; }, where: () => chain, orderBy: () => chain,
                for: async () => table === locations ? [{ id: 1, layoutRevision: revision }] : [row],
                then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(table === categories ? [{ id: 9 }] : []).then(resolve) };
            return chain;
        },
        execute: async () => {},
        update: (table: unknown) => ({ set: (patch: Record<string, unknown>) => ({ where: async () => { updates.push({ table, patch }); if (fail) throw new Error("storage failed"); if (table === devices) Object.assign(row, patch); } }) }),
    };
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
        const before = { ...row };
        try { await callback(tx); } catch (error) { Object.keys(row).forEach((key) => delete row[key]); Object.assign(row, before); throw error; }
    });
    return { row, updates };
}

beforeEach(() => vi.clearAllMocks());
describe("facility conversion trust boundary", () => {
    it("updates only conversion fields while retaining ID, photo, IP and audit-related flags", async () => {
        mocks.auth.mockResolvedValue({ ok: true, activeSiteId: 1 });
        const state = persistence({ ...original, id: 1, photoPath: "photo.jpg", ipAddress: "10.0.0.1", isCritical: true, excludeChecklist: false });
        expect(await convertFacilityDevice(payload)).toMatchObject({ success: true });
        expect(state.row).toMatchObject({ id: 1, assetType: "ups", categoryId: 9, rackName: null, rackPosition: null, uHeight: null, photoPath: "photo.jpg", ipAddress: "10.0.0.1", isCritical: true, excludeChecklist: false });
        expect((state.row.facilitySpecs as { ratedKw: unknown }).ratedKw).toBeNull();
        expect(Object.keys(state.updates.find((u) => u.table === devices)!.patch).sort()).toEqual(["assetType", "categoryId", "facilitySpecs", "floorRotation", "floorX", "floorZ", "locationId", "rackName", "rackPosition", "uHeight"]);
    });
    it("rejects changed device or room revision before mutation", async () => {
        mocks.auth.mockResolvedValue({ ok: true, activeSiteId: 1 });
        let state = persistence({ ...original, id: 1, rackPosition: 2 });
        expect(await convertFacilityDevice(payload)).toMatchObject({ success: false });
        expect(state.updates).toEqual([]);
        state = persistence({ ...original, id: 1 }, 2);
        expect(await convertFacilityDevice(payload)).toMatchObject({ success: false });
        expect(state.updates).toEqual([]);
    });
    it("reports transaction failure without claiming successful conversion", async () => {
        mocks.auth.mockResolvedValue({ ok: true, activeSiteId: 1 });
        const state = persistence({ ...original, id: 1 }, 0, true);
        expect(await convertFacilityDevice(payload)).toMatchObject({ success: false });
        expect(state.row).toMatchObject({ assetType: "standard", rackPosition: 1, uHeight: 4 });
    });
    it("refuses unauthorized conversion without touching persistence", async () => {
        mocks.auth.mockResolvedValue({ ok: false, message: "Unauthorized" });
        expect(await convertFacilityDevice({})).toMatchObject({ success: false, message: "Unauthorized" });
        expect(mocks.transaction).not.toHaveBeenCalled();
    });
    it("rejects malformed and cross-site conversion requests", async () => {
        mocks.auth.mockResolvedValue({ ok: true, activeSiteId: 1 });
        expect(await convertFacilityDevice({})).toMatchObject({ success: false });
        expect(await convertFacilityDevice({ siteId: 2, deviceId: 1,
            original: { assetType: "standard", categoryId: 1, locationId: 1, rackName: "UPS", rackPosition: 1, uHeight: 4 },
            asset: { assetType: "ups", facilitySpecs: { subtype: "floor-standing", capacityKva: 20 }, locationId: 1, floorX: null, floorZ: null, floorRotation: null },
            roomRevision: 0,
        })).toMatchObject({ success: false });
        expect(mocks.transaction).not.toHaveBeenCalled();
    });
});
