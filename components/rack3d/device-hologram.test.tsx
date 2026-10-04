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

// Two ports on a 4-slot, one-row faceplate: slots 1 and 2 are occupied
// (1 wired to SW-2, 2 unlinked) and slots 3 and 4 are empty.
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
    faceplatePortCount: 4, faceplateUplinkCount: 0, faceplateRows: 1, faceplateNumbering: "sequential",
    rackPosition: 10, rackName: "R1", locationName: "Room A",
} as never;

const baseProps = {
    ports: ports as never,
    loading: false,
    deviceOptions: [{ id: 7, name: "SW-2", locationName: "Room A" }],
    onClose: () => {},
    onLinked: () => {},
    onOpenPanel: () => {},
};

describe("DeviceHologram faceplate", () => {
    it("draws one slot per declared port and a linked count", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} />);
        expect(html).toContain("SW-1");
        expect(html).toContain("1/2 Linked");
        // Only the two occupied slots are interactive.
        expect(html.split('role="button"').length - 1).toBe(2);
        expect(html).toContain(">3<");
        expect(html).toContain(">4<");
    });

    it("describes the hovered occupied slot through the 2D strip text", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} hoveredSlotKey="access-1" />);
        expect(html).toContain("VLAN 10");
        expect(html).toContain("SW-2");
    });

    it("never promises provisioning on an empty slot", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} hoveredSlotKey="access-3" />);
        expect(html).toContain("empty");
        expect(html).not.toContain("provisioning");
    });

    it("opens a detail panel with the link entry point for an occupied slot", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} selectedSlotKey="access-1" />);
        expect(html).toContain("Edit link");
    });

    it("offers the link button for an occupied slot that has no peer yet", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} selectedSlotKey="access-2" />);
        expect(html).toContain("Edit link");
        expect(html).toContain("Not linked");
    });

    it("opens nothing for an empty slot", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} selectedSlotKey="access-3" />);
        expect(html).not.toContain("Edit link");
    });

    it("falls back to a message with a network-docs link when no faceplate is configured", () => {
        const bare = { ...(device as object), faceplatePortCount: 0 } as never;
        const html = renderToStaticMarkup(<DeviceHologram device={bare} {...baseProps} />);
        expect(html).toContain("Faceplate not configured");
        expect(html).toContain("/admin/devices/1/network");
    });

    it("keeps an empty faceplate on screen when the device documents no ports", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} ports={[]} />);
        expect(html).toContain("0/0 Linked");
        expect(html).not.toContain("No ports documented");
        expect(html.split('role="button"').length - 1).toBe(0);
    });

    it("keeps the loading and panel/full-docs entry points", () => {
        const loading = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} ports={[]} loading />);
        expect(loading).toContain("Loading ports");
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} />);
        expect(html).toContain("Panel");
        expect(html).toContain("/admin/devices/1/network");
    });

    it("applies the stagger offset as a translateY on the card", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} offsetY={-9} />);
        expect(html).toContain("translateY(-9rem)");
    });
});
