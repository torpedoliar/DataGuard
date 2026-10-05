import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RackDevice } from "@/actions/rack-layout";
vi.mock("next/dynamic", () => ({ default: () => () => <div>Generic preview</div> }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("./device-drawer-sections", () => ({ useDeviceDrawer: () => ({ data: null, loading: false, error: true }), AuditSection: () => null, IncidentsSection: () => null, SiemSection: () => null, ConnectionsSection: () => null }));
vi.mock("./device-network-summary", () => ({ default: () => null }));
import DeviceDetailPanel from "./device-detail-panel";
const device = { id: 1, name: "Actual switch", rackPosition: 8, status: "NOT OK", isCritical: false } as RackDevice;
describe("DeviceDetailPanel", () => {
    it("offers actual-data tabs and marks failed loading rather than inventing status", () => {
        const html = renderToStaticMarkup(<DeviceDetailPanel docked device={device} onClose={() => {}} />);
        for (const name of ["Overview", "Network", "Connections", "Docs"]) expect(html).toContain(name);
        expect(html).toContain("Unable to load device details.");
        expect(html).toContain("Actual switch");
        expect(html).toContain("NOT OK");
        expect(html).not.toContain("Online");
    });
    it("keeps the existing 2D overlay without 3D preview or tabs", () => {
        const html = renderToStaticMarkup(<DeviceDetailPanel device={device} onClose={() => {}} />);
        expect(html).not.toContain("Generic preview");
        expect(html).not.toContain('role="tablist"');
    });
});
