import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock("next/link", () => ({
    default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { DeviceCard3D } from "./device-card-3d";

const drawer = {
    picGroups: [],
    lastAudit: null,
    incidents: [],
    siem: { count: 0, latest: [] },
    connections: [
        { portName: "1", portMode: "Access", vlan: 10, peerDeviceId: 7, peerDeviceName: "SW-2", peerPortName: "5" },
    ],
};

const device = {
    id: 1,
    name: "SW-1",
    ipAddress: "10.0.0.1",
    rackName: "R1",
    rackPosition: 22,
    brandName: "Cisco",
} as never;

describe("DeviceCard3D", () => {
    it("shows identity, link status and wired port rows", () => {
        const html = renderToStaticMarkup(
            <DeviceCard3D device={device} drawer={drawer as never} loading={false} onClose={() => {}} onSelectPeer={() => {}} />,
        );
        expect(html).toContain("SW-1");
        expect(html).toContain("10.0.0.1");
        expect(html).toContain("1/1 Linked");
        expect(html).toContain("Port 1 to SW-2");
        expect(html).toContain("/admin/devices/1/network");
    });

    it("shows a loading state and an empty state with no connections", () => {
        const loading = renderToStaticMarkup(
            <DeviceCard3D device={device} drawer={null} loading onClose={() => {}} />,
        );
        expect(loading).toContain("Loading ports");
        const empty = renderToStaticMarkup(
            <DeviceCard3D device={device} drawer={{ ...drawer, connections: [] } as never} loading={false} onClose={() => {}} />,
        );
        expect(empty).toContain("No documented cabling");
    });

    it("wires the port row to onSelectPeer", () => {
        const onSelectPeer = vi.fn();
        // Static markup cannot fire clicks; assert the handler prop Threading
        // by rendering with a spy and checking the labelled button exists.
        const html = renderToStaticMarkup(
            <DeviceCard3D device={device} drawer={drawer as never} loading={false} onClose={() => {}} onSelectPeer={onSelectPeer} />,
        );
        expect(html).toContain('aria-label="Port 1 to SW-2"');
        expect(onSelectPeer).not.toHaveBeenCalled();
    });
});
