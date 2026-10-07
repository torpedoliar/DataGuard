import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RackDevice } from "@/actions/rack-layout";
vi.mock("@/actions/network", () => ({ getPortsByDevice: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
import DeviceNetworkSummary, { portMatchesVlan } from "./device-network-summary";

type Port = NonNullable<React.ComponentProps<typeof DeviceNetworkSummary>["supplied"]>["ports"][number];
const device = { id: 1, name: "Core", faceplatePortCount: 12, faceplateRows: 2 } as RackDevice;
const port = (id: number, values: Partial<Port> = {}): Port => ({ id, deviceId: 1, portName: `port1.0.${id}`, portIndex: null, macAddress: null, ipAddress: null, portMode: "Trunk", vlanId: null, vlanNumber: null, vlanName: null, trunkVlans: "4, 8, 10-12", status: "Active", speed: "1G", mediaType: "Copper (RJ45)", connectedToDeviceId: null, connectedToDeviceName: null, connectedToPortId: null, connectedToPortName: "", description: null, ...values });

describe("DeviceNetworkSummary", () => {
    it("keeps VLAN configuration attached to naturally ordered port rows", () => {
        const html = renderToStaticMarkup(<DeviceNetworkSummary device={device} expanded supplied={{ ports: [port(10), port(2, { portMode: "Access", vlanNumber: 900, vlanName: "DMZ", trunkVlans: null })], loading: false }} />);
        expect(html).toContain("Filter VLAN");
        expect(html).toContain("Access VLAN: 900 · DMZ");
        expect(html).toContain("Allowed VLANs: 4, 8, 10-12");
        expect(html.indexOf('data-port-row="2"')).toBeLessThan(html.indexOf('data-port-row="10"'));
        expect(html).toContain('aria-label="Slot 2 · port1.0.2');
        expect(html).toContain('>2</text>');
        expect(html).toContain("Arahkan atau fokuskan port");
    });
    it("matches native/access VLANs and exact allowed VLANs including ranges", () => {
        expect(portMatchesVlan(port(1, { vlanNumber: 900 }), "900")).toBe(true);
        expect(portMatchesVlan(port(1), "11")).toBe(true);
        expect(portMatchesVlan(port(1), "1")).toBe(false);
        expect(portMatchesVlan(port(1, { trunkVlans: null }), "4")).toBe(false);
        expect(portMatchesVlan(port(1, { trunkVlans: "all" }), "4094")).toBe(true);
        expect(portMatchesVlan(port(1, { portMode: "Access" }), "4")).toBe(false);
    });
    it("renders configured access and uplink slots even before any ports are documented", () => {
        const device = { id: 1, name: "Uplink panel", faceplatePortCount: 4, faceplateUplinkCount: 4, faceplateRows: 1, faceplateNumbering: "sequential" } as RackDevice;
        const html = renderToStaticMarkup(<DeviceNetworkSummary device={device} supplied={{ ports: [], loading: false }} />);
        expect(html).toContain("faceplate: 0 active of 8 ports");
        expect(html).not.toContain("No network ports documented");
    });
});
