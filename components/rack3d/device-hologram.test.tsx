import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock("next/link", () => ({
    default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
// The hologram reads audit/SIEM summary through the shared drawer hook.
vi.mock("@/components/admin/device-drawer-sections", () => ({
    useDeviceDrawer: () => ({ loading: false, data: null }),
}));

import { DeviceHologram } from "./device-hologram";

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

const device = {
    id: 1, name: "SW-1", ipAddress: "10.0.0.1", status: "OK",
    openIncidents: { count: 0, items: [] },
} as never;

const baseProps = {
    ports: ports as never,
    loading: false,
    deviceOptions: [{ id: 7, name: "SW-2", locationName: "Room A" }],
    onClose: () => {},
    onPickPort: () => {},
    onLinked: () => {},
    onOpenPanel: () => {},
};

describe("DeviceHologram", () => {
    it("renders every port with peer and VLAN info plus the linked count", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} />);
        expect(html).toContain("SW-1");
        expect(html).toContain("Port 1 to SW-2");
        expect(html).toContain("VLAN 10");
        expect(html).toContain("1/2 Linked");
    });

    it("shows empty ports as Not linked, the status summary and a loading state", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} />);
        expect(html).toContain("Link port 2 to a target device");
        expect(html).toContain("Not linked");
        expect(html).toContain("OK");
        const loading = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} ports={[]} loading />);
        expect(loading).toContain("Loading ports");
    });

    it("exposes the panel and full-docs entry points", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} />);
        expect(html).toContain("Panel");
        expect(html).toContain("/admin/devices/1/network");
    });
});
