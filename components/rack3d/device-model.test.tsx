import React, { type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { RoundedBox } from "@react-three/drei";
import type { FilteredDevice } from "@/lib/rack-filter";
vi.mock("./materials", () => ({ sharedMaterials: {}, portMaterials: [], ledMaterial: () => null }));
import { DeviceModel, deviceOpacity } from "./device-model";
import { U } from "./constants";

function find(e: ReactElement, type: unknown): ReactElement | undefined {
    if (e.type === type) return e;
    for (const child of React.Children.toArray((e.props as { children?: React.ReactNode }).children)) {
        if (React.isValidElement(child)) { const hit = find(child, type); if (hit) return hit; }
    }
}
describe("DeviceModel", () => {
    it("owns decorative opacity without mutating shared LEDs", () => {
        expect(deviceOpacity(0.12)).toEqual({ userData: { ownFade: true }, transparent: true, opacity: 0.12 });
        const tree = DeviceModel({ device: { uHeight: 1, categoryName: "Server", name: "Server" } as FilteredDevice, opacity: 0.12 });
        const material = find(tree, "meshStandardMaterial")!;
        expect((material.props as { opacity: number }).opacity).toBe(0.12);
    });
    it("uses a low-cost chassis without screw geometry for overview devices", () => {
        const tree = DeviceModel({ device: { uHeight: 2, categoryName: "Server", name: "Server" } as FilteredDevice, detailed: false });
        expect(find(tree, RoundedBox)).toBeUndefined();
        expect(find(tree, "cylinderGeometry")).toBeUndefined();
        expect((find(tree, "boxGeometry")!.props as { args: number[] }).args).toEqual([0.44, 2 * U - 0.0015, 0.72]);
    });
    it("centres a full-depth chassis and preserves actual U height", () => {
        const tree = DeviceModel({ device: { uHeight: 4, categoryName: "Storage", name: "NAS" } as FilteredDevice });
        const chassis = find(tree, RoundedBox)!;
        expect((chassis.props as { args: number[] }).args).toEqual([0.44, 4 * U - 0.0015, 0.72]);
        expect((tree.props as { position?: unknown }).position).toBeUndefined();
    });
});
