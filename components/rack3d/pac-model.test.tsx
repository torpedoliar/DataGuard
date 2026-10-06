import React from "react";
import { describe, expect, it, vi } from "vitest";
vi.mock("./textures", () => ({ perforationTexture: () => null, repeated: () => ({ dispose() {} }) }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useMemo: (run: () => unknown) => run(), useEffect: () => {} }));
import { FacilityModel } from "./facility-model";
import { LeonardoModel, InRowModel } from "./pac-model";
import type { RackDevice } from "@/actions/rack-layout";
import { facilityAssetSchema } from "@/lib/facility-asset";

function checkBoxes(node: React.ReactNode, limits: number[], offset = [0, 0, 0]) {
    React.Children.forEach(node, (child) => {
        if (!React.isValidElement(child)) return;
        const element = child as React.ReactElement<{ position?: number[]; size?: number[]; children?: React.ReactNode }>;
        if (typeof element.type === "function" && element.props.size) {
            const p = element.props.position ?? [0, 0, 0];
            element.props.size.forEach((size, axis) => expect(Math.abs(offset[axis] + p[axis]) + size / 2).toBeLessThanOrEqual(limits[axis] / 2 + 1e-8));
            return;
        }
        const position = element.props.position ?? [0, 0, 0];
        checkBoxes(element.props.children, limits, offset.map((v, axis) => v + position[axis]));
    });
}

describe("PAC profile model integration", () => {
    it("keeps cabinet panels and details within reference outer dimensions", () => {
        checkBoxes(LeonardoModel({ width: 0.83, depth: 0.44, height: 2, opacity: 1, detailed: true }), [0.83, 2, 0.44]);
        checkBoxes(InRowModel({ width: 0.3, depth: 1.095, height: 1.991, opacity: 1, detailed: true }), [0.3, 1.991, 1.095]);
    });
    it.each([
        ["leonardo-tuar0611", "top-blow", LeonardoModel, 0.83, 0.44, 2],
        ["inrow-300", "in-row", InRowModel, 0.3, 1.095, 1.991],
    ] as const)("uses %s in shared scene and thumbnail model", (visualProfile, subtype, model, width, depth, height) => {
        const asset = facilityAssetSchema.parse({ assetType: "pac", facilitySpecs: { subtype, visualProfile }, locationId: 1, floorX: null, floorZ: null, floorRotation: null });
        const tree = FacilityModel({ device: asset as RackDevice });
        expect(tree.type).toBe(model);
        expect(tree.props).toMatchObject({ width, depth, height });
    });
    it("opts into fan motion without enabling it for static previews", () => {
        const asset = facilityAssetSchema.parse({ assetType: "pac", facilitySpecs: { subtype: "in-row", visualProfile: "inrow-300" }, locationId: 1, floorX: null, floorZ: null, floorRotation: null });
        expect(FacilityModel({ device: asset as RackDevice }).props.animateFans).toBe(false);
        expect(FacilityModel({ device: asset as RackDevice, animateFans: true }).props.animateFans).toBe(true);
    });
    it("keeps the InRow's eight fan openings inside the 300mm face", () => {
        const tree = InRowModel({ width: 0.3, depth: 1.095, height: 1.991, opacity: 1, detailed: true });
        const groups = React.Children.toArray(tree.props.children).filter(React.isValidElement) as React.ReactElement<{ position?: number[]; children?: React.ReactNode }>[];
        const fans = groups.filter((g) => g.type === "group" && g.props.position);
        expect(fans).toHaveLength(8);
        for (const fan of fans) expect(Math.abs(fan.props.position![1]) + 0.3 * 0.395).toBeLessThan(1.991 / 2);
    });
});
