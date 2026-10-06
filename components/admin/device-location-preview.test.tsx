import React from "react";
import { describe, expect, it, vi } from "vitest";
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useState: (value: unknown) => [value, () => {}] }));
vi.mock("next/dynamic", () => ({ default: () => "preview-3d" }));
import DeviceLocationPreview from "./device-location-preview";
import type { getDeviceProfile } from "@/actions/device-profile";
function text(node: React.ReactNode): string {
    return React.Children.toArray(node).map((child) => React.isValidElement(child) ? text((child.props as { children?: React.ReactNode }).children) : String(child)).join(" ");
}
describe("read-only profile rack location", () => {
    it("highlights the full occupied U range without mounting 3D by default", () => {
        const device = { id: 42, assetType: "standard", name: "Server", rackPosition: 2, uHeight: 2 };
        const profile = { device, visualDevice: device, rack: { name: "Rack A", totalU: 4, devices: [device] }, roomRacks: [], facilities: [], room: null } as unknown as NonNullable<Awaited<ReturnType<typeof getDeviceProfile>>>;
        const tree = DeviceLocationPreview({ profile });
        expect(text(tree)).toContain("U 3 Server U 2 Server");
        expect(text(tree)).toContain("U 4 Available");
        const inspect = (node: React.ReactNode): boolean => React.Children.toArray(node).some((child) => React.isValidElement(child) && (child.type === "preview-3d" || inspect((child.props as { children?: React.ReactNode }).children)));
        expect(inspect(tree)).toBe(false);
    });
    it("does not invent a floor position for unplaced facilities", () => {
        const profile = { device: { id: 42, assetType: "ups", floorX: null, floorZ: null }, rack: null, facilities: [], roomRacks: [], room: null } as unknown as NonNullable<Awaited<ReturnType<typeof getDeviceProfile>>>;
        expect(text(DeviceLocationPreview({ profile }))).toContain("Belum memiliki penempatan");
    });
});
