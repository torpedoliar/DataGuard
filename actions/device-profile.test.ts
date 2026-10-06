import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), devices: vi.fn(), layout: vi.fn(), rooms: vi.fn() }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAction: mocks.auth }));
vi.mock("./master-data", () => ({ getDevices: mocks.devices }));
vi.mock("./rack-layout", () => ({ getProfileLayout: mocks.layout, getRoomSettings: mocks.rooms }));
import { getDeviceProfile } from "./device-profile";
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ ok: true, activeSiteId: 7 }); mocks.layout.mockResolvedValue({ racks: [], facilities: [] }); mocks.rooms.mockResolvedValue({}); });
describe("device profile scope", () => {
    it("rejects invalid or inaccessible ids without loading placement context", async () => {
        expect(await getDeviceProfile(-1)).toBeNull();
        mocks.devices.mockResolvedValue([]);
        expect(await getDeviceProfile(42)).toBeNull();
        expect(mocks.layout).not.toHaveBeenCalled();
    });
    it("keeps an unracked device available without invented placement", async () => {
        mocks.devices.mockResolvedValue([{ id: 42, name: "Loose", locationId: null }]);
        expect(await getDeviceProfile(42)).toMatchObject({ device: { id: 42 }, rack: null, room: null });
    });
    it("refuses unauthenticated profile reads", async () => {
        mocks.auth.mockResolvedValue({ ok: false });
        expect(await getDeviceProfile(42)).toBeNull();
        expect(mocks.devices).not.toHaveBeenCalled();
    });
});
