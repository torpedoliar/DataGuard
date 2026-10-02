import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock("next/link", () => ({
    default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { DeviceCardPanel } from "./device-card-panel";

const ports = [
    {
        id: 1, deviceId: 1, portName: "1", portIndex: 1, macAddress: null, ipAddress: null,
        portMode: "Access", vlanId: 3, vlanName: "SRV", vlanNumber: 10, trunkVlans: null,
        status: "Active", speed: null, mediaType: null,
        connectedToDeviceId: 7, connectedToDeviceName: "SW-2",
        connectedToPortId: 9, connectedToPortName: "5", description: null,
    },
    {
        id: 2, deviceId: 1, portName: "2", portIndex: 2, macAddress: null, ipAddress: null,
        portMode: "Access", vlanId: null, vlanName: null, vlanNumber: null, trunkVlans: null,
        status: "Inactive", speed: null, mediaType: null,
        connectedToDeviceId: null, connectedToDeviceName: null,
        connectedToPortId: null, connectedToPortName: null, description: null,
    },
];

const device = { id: 1, name: "SW-1", ipAddress: "10.0.0.1", photoPath: "/uploads/x.jpg" } as never;

describe("DeviceCardPanel", () => {
    it("renders every port with peer and VLAN info from network docs", () => {
        const html = renderToStaticMarkup(
            <DeviceCardPanel device={device} ports={ports as never} loading={false} onClose={() => {}} onSelectPeer={() => {}} />,
        );
        expect(html).toContain("SW-1");
        expect(html).toContain("Port 1 to SW-2");
        expect(html).toContain("VLAN 10");
        expect(html).toContain("1/2 Linked");
    });

    it("shows all ports including unlinked ones, plus photo and full docs link", () => {
        const html = renderToStaticMarkup(
            <DeviceCardPanel device={device} ports={ports as never} loading={false} onClose={() => {}} onSelectPeer={() => {}} />,
        );
        expect(html).toContain("Port 2");
        expect(html).toContain("Not linked");
        expect(html).toContain('src="/uploads/x.jpg"');
        expect(html).toContain("/admin/devices/1/network");
    });

    it("shows a loading state when ports are being fetched", () => {
        const html = renderToStaticMarkup(
            <DeviceCardPanel device={device} ports={[]} loading onClose={() => {}} />,
        );
        expect(html).toContain("Loading ports");
    });
});
