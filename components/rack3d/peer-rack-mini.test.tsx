import React, { type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

// Texture creation needs a browser canvas; keep the cabinet real but replace
// only its eagerly created WebGL materials in this node-only test.
vi.mock("./materials", () => ({ sharedMaterials: {}, portMaterials: [], ledMaterial: () => null }));
import type { SceneRack } from "@/lib/rack-filter";
import PeerRackMini from "./peer-rack-mini";
import { RackCabinet } from "./rack-cabinet";

function findCabinet(element: ReactElement): ReactElement | undefined {
    if (element.type === RackCabinet) return element;
    const children = (element.props as { children?: React.ReactNode }).children;
    for (const child of React.Children.toArray(children)) {
        if (!React.isValidElement(child)) continue;
        const found = findCabinet(child);
        if (found) return found;
    }
}

describe("PeerRackMini", () => {
    it("renders the real cabinet and device models, highlighting the peer without filter fading", () => {
        const rack = {
            name: "Wall rack", totalU: 12, dimmed: true,
            devices: [{ id: 42, rackPosition: 2, uHeight: 1, isMuted: true }],
        } as SceneRack;
        const tree = PeerRackMini({ rack, peerId: 42 });
        const cabinet = findCabinet(tree);
        expect(cabinet).toBeDefined();
        const props = cabinet!.props as React.ComponentProps<typeof RackCabinet>;
        expect(props.placed.rack.devices[0].isMuted).toBe(false);
        expect(props.focused).toBe(true);
        expect(props.faded).toBe(false);
        expect(props.selectedDeviceId).toBe(42);
        expect(props.placed.rotationY).toBe(0);
    });
});
