import React from "react";
import { describe, expect, it, vi } from "vitest";
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useMemo: (run: () => unknown) => run() }));
vi.mock("./textures", () => ({ radialTexture: () => null }));
import { DocumentedPorts } from "./device-model";
import { portMaterials } from "./materials";

describe("documented port LED visibility", () => {
    it("places active LED geometry ahead of the opaque port recess", () => {
        const tree = DocumentedPorts({ opacity: 1, slots: [{ x: 0, y: 0, w: 0.01, h: 0.01, uplink: false, state: "active", phase: 0, portId: 1 }] });
        const groups = React.Children.toArray(tree.props.children).filter(React.isValidElement) as React.ReactElement<{ material?: unknown; children?: React.ReactNode }>[];
        const led = groups.find((g) => g.props.material === portMaterials[0])!;
        const children = React.Children.toArray(led.props.children).filter(React.isValidElement) as React.ReactElement<{ position?: number[] }>[];
        const instance = children.find((g) => g.props.position)!;
        expect(instance.props.position![2]).toBeGreaterThan(0.0045);
    });
});
