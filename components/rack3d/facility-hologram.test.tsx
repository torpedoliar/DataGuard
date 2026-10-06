import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FacilityHologram } from "./facility-hologram";
import type { RackDevice } from "@/actions/rack-layout";
import { facilityAssetSchema } from "@/lib/facility-asset";

const device = { id: 1, name: "UPS APC", locationName: "Room", status: "Pending", ipAddress: null,
    ...facilityAssetSchema.parse({ assetType: "ups", facilitySpecs: { subtype: "floor-standing", visualProfile: "apc-20kva", capacityKva: 20 }, locationId: 1, floorX: 1, floorZ: 1, floorRotation: 0 }),
} as RackDevice;
describe("facility hologram", () => {
    it("shows actual capacities and unknown kW without network faceplate instructions", () => {
        const html = renderToStaticMarkup(<FacilityHologram device={device} drawerState={{ data: null, loading: true, error: false }} onClose={() => {}} onOpenPanel={() => {}} />);
        expect(html).toContain("20"); expect(html).toContain("? kW");
        expect(html).toContain("Ukuran referensi perkiraan");
        expect(html).not.toContain("Faceplate"); expect(html).not.toContain("U1");
        expect(html).toContain("Memuat audit");
    });
    it("exposes room cabinet controls only when supplied", () => {
        const html = renderToStaticMarkup(<FacilityHologram device={device} drawerState={{ data: null, loading: false, error: true }} onClose={() => {}} onOpenPanel={() => {}} onToggleCabinet={() => {}} cabinetOpen />);
        expect(html).toContain("Tutup PAC"); expect(html).toContain("Gagal memuat detail");
    });
});
