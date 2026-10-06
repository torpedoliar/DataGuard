import { describe, expect, it, vi } from "vitest";
vi.mock("./textures", () => ({ radialTexture: () => null }));
import { portMaterials, sharedMaterials, tickLeds } from "./materials";

describe("visible port blinking", () => {
    it("turns an active LED fully dark between lit frames, without changing Down LEDs", () => {
        tickLeds(0);
        const lit = portMaterials[0].emissiveIntensity;
        tickLeds(0.5);
        expect(portMaterials[0].emissiveIntensity).toBe(0);
        expect(portMaterials[0].color.getHex()).toBe(0x000000);
        expect(lit).toBeGreaterThan(1);
        expect(sharedMaterials.portDown.emissiveIntensity).toBe(1.6);
        tickLeds(1);
        expect(portMaterials[0].color.getHex()).toBe(0x22c55e);
    });
});
