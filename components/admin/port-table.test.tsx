import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PortTable from "./port-table";

type TestPort = {
    id: number;
    deviceId: number;
    portName: string;
    portIndex?: number | null;
    macAddress: string | null;
    ipAddress: string | null;
    portMode: string | null;
    vlanId: number | null;
    vlanName: string | null;
    vlanNumber: number | null;
    trunkVlans: string | null;
    status: string | null;
    speed: string | null;
    mediaType: string | null;
    connectedToDeviceId: number | null;
    connectedToDeviceName: string | null;
    connectedToPortId: number | null;
    connectedToPortName: string | null;
    description: string | null;
};

function port(id: number, portName: string, extra: Partial<TestPort> = {}): TestPort {
    return {
        id,
        deviceId: 1,
        portName,
        macAddress: null,
        ipAddress: null,
        portMode: null,
        vlanId: null,
        vlanName: null,
        vlanNumber: null,
        trunkVlans: null,
        status: "Active",
        speed: null,
        mediaType: null,
        connectedToDeviceId: null,
        connectedToDeviceName: null,
        connectedToPortId: null,
        connectedToPortName: null,
        description: null,
        ...extra,
    };
}

describe("PortTable slot column", () => {
    it("renders the resolved slot number for the port that occupies it", () => {
        const html = renderToStaticMarkup(
            React.createElement(PortTable, {
                ports: [port(1, "Gi1/0/1")],
                vlans: [],
                otherDevices: [],
                deviceId: 1,
                faceplateConfig: { portCount: 8 },
            }),
        );

        // Slot cell renders "1" with the auto badge (no portIndex set).
        expect(html).toContain(">1<span");
        expect(html).not.toContain("Unmapped");
    });

    it("marks a port that lost its slot to a collision as Unmapped", () => {
        const html = renderToStaticMarkup(
            React.createElement(PortTable, {
                // Eth3 sorts before Gi1/0/3 and keeps slot 3 on the diagram;
                // Gi1/0/3 resolves to the same slot and is placed nowhere.
                ports: [port(1, "Gi1/0/3"), port(2, "Eth3")],
                vlans: [],
                otherDevices: [],
                deviceId: 1,
                faceplateConfig: { portCount: 8 },
            }),
        );

        expect(html).toContain("Unmapped");
        // Exactly one slot-number cell for slot 3 (the occupant, with auto badge).
        expect(html.match(/>3<span/g)).toHaveLength(1);
    });

    it("does not show the slot column without a faceplate", () => {
        const html = renderToStaticMarkup(
            React.createElement(PortTable, {
                ports: [port(1, "Gi1/0/1")],
                vlans: [],
                otherDevices: [],
                deviceId: 1,
            }),
        );

        expect(html).not.toContain("Unmapped");
        expect(html).not.toContain(">1<span");
    });
});
