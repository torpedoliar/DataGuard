import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

// The card loads the R3F mini through next/dynamic; the node test environment
// has no WebGL, so the dynamic component is replaced with a stub. This is the
// whole reason peer-rack-mini.tsx is a separate file.
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="peer-mini" /> }));

import { PeerRackCard } from "./peer-rack-card";

const peer = {
    id: 42, name: "SW-9", rackPosition: 12, uHeight: 1, categoryColor: "#3b82f6",
} as never;

const rack = {
    name: "R2", totalU: 42, devices: [peer], locationName: "Room B",
} as never;

describe("PeerRackCard", () => {
    it("names the room, rack and unit of the peer", () => {
        const html = renderToStaticMarkup(<PeerRackCard rack={rack} peer={peer} portName="5" onMove={() => {}} onClose={() => {}} />);
        expect(html).toContain("Room B");
        expect(html).toContain("R2");
        expect(html).toContain("U12");
        expect(html).toContain("SW-9");
    });

    it("labels the destination port and both actions", () => {
        const html = renderToStaticMarkup(<PeerRackCard rack={rack} peer={peer} portName="5" onMove={() => {}} onClose={() => {}} />);
        expect(html).toContain("Port 5");
        expect(html).toContain("Move to location");
        expect(html).toContain("Close peer rack card");
    });

    it("reads as unassigned when the rack hangs off no location", () => {
        const loose = { ...(rack as object), locationName: null } as never;
        const html = renderToStaticMarkup(<PeerRackCard rack={loose} peer={peer} portName={null} onMove={() => {}} onClose={() => {}} />);
        expect(html).toContain("Unassigned Location");
        expect(html).not.toContain("null");
    });

    it("falls back to a generic port label when the port is unknown", () => {
        const html = renderToStaticMarkup(<PeerRackCard rack={rack} peer={peer} portName={null} onMove={() => {}} onClose={() => {}} />);
        expect(html).toContain("Peer port");
    });
});
