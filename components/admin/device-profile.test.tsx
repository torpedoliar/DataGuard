import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
import DeviceProfile from "./device-profile";
import type { getDeviceProfile } from "@/actions/device-profile";
const profile = { device: { id: 1, name: "UPS actual", assetType: "ups", categoryName: "Power", facilitySpecs: { subtype: "floor-standing", capacityKva: 20, ratedKw: null }, locationName: "Room", rackName: null, photoPath: null }, visualDevice: null, rack: null, roomRacks: [], facilities: [], room: null } as unknown as NonNullable<Awaited<ReturnType<typeof getDeviceProfile>>>;
const drawer = { loading: false, error: false, data: { picGroups: [], lastAudit: null, incidents: [], siem: { count: 0, latest: [] }, connections: [] } };
describe("read-only device profile", () => {
    it("shows real facility data without edit controls for read-only access", () => {
        const html = renderToStaticMarkup(<DeviceProfile deviceId={1} revision={0} canEdit={false} onClose={() => {}} onEdit={() => {}} onSelectPeer={() => false} suppliedProfile={profile} suppliedDrawer={drawer} />);
        expect(html).toContain("UPS actual");
        expect(html).toContain("20");
        expect(html).toContain("20 kVA / ? kW");
        expect(html).not.toContain("Hapus Device");
        expect(html).not.toContain(">Edit<");
        expect(html).toContain("Belum memiliki penempatan");
    });
});
