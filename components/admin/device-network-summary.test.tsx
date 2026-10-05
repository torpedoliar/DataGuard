import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RackDevice } from "@/actions/rack-layout";
vi.mock("@/actions/network", () => ({ getPortsByDevice: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
import DeviceNetworkSummary from "./device-network-summary";

describe("DeviceNetworkSummary", () => {
    it("renders configured access and uplink slots even before any ports are documented", () => {
        const device = { id: 1, name: "Uplink panel", faceplatePortCount: 4, faceplateUplinkCount: 4, faceplateRows: 1, faceplateNumbering: "sequential" } as RackDevice;
        const html = renderToStaticMarkup(<DeviceNetworkSummary device={device} supplied={{ ports: [], loading: false }} />);
        expect(html).toContain("faceplate: 0 active of 8 ports");
        expect(html).not.toContain("No network ports documented");
    });
});
