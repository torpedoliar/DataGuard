import React, { type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FilteredDevice } from "@/lib/rack-filter";
import { Html } from "@react-three/drei";

// Inspect the component's hover branch without mounting a WebGL renderer.
vi.mock("react", async (original) => ({
    ...await original<typeof import("react")>(),
    useState: () => [true, () => {}],
    useRef: () => ({ current: null }),
    useEffect: () => {},
}));
vi.mock("@react-three/fiber", () => ({ useFrame: () => {}, useThree: () => () => {} }));
vi.mock("./materials", () => ({ sharedMaterials: {}, portMaterials: [], ledMaterial: () => null }));

import { RackDevice } from "./rack-device";

function tooltip(element: ReactElement): ReactElement | undefined {
    if (element.type === Html) return element;
    for (const child of React.Children.toArray((element.props as { children?: React.ReactNode }).children)) {
        if (React.isValidElement(child)) {
            const found = tooltip(child);
            if (found) return found;
        }
    }
}

describe("RackDevice hover", () => {
    it("makes the screen-space tooltip non-interactive so it cannot steal hover from its device", () => {
        const device = {
            id: 1, name: "Switch", rackPosition: 1, uHeight: 1,
            categoryName: "NETWORK", openIncidents: { count: 0 },
        } as FilteredDevice;
        const tree = RackDevice({ device, selected: false, faded: false, accent: "#5eead4", colorBy: "category", onSelect: () => {} });
        const html = tooltip(tree);
        expect(html).toBeDefined();
        // Drei applies pointerEvents prop only in transform mode. The ordinary
        // screen-space Html must receive the style on its actual DOM wrapper.
        expect((html!.props as React.ComponentProps<typeof Html>).style?.pointerEvents).toBe("none");
    });
});
