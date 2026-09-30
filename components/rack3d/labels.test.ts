import { describe, expect, it, vi } from "vitest";

vi.mock("three", () => ({
    CanvasTexture: class { dispose = vi.fn(); },
    SRGBColorSpace: "srgb",
}));

// document.createElement is the only DOM bit drawLabel needs.
vi.stubGlobal("document", {
    createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
            fillRect: () => {},
            fillText: () => {},
            measureText: () => ({ width: 10 }),
        }),
    }),
});

describe("acquireLabel", () => {
    it("shares one texture between users and frees it with the last one", async () => {
        const { acquireLabel, liveLabelCount } = await import("./textures");
        expect(liveLabelCount()).toBe(0);
        const a = acquireLabel("RACK-A1", "#0f172a");
        const b = acquireLabel("RACK-A1", "#0f172a");
        expect(a.tex).toBe(b.tex);
        expect(liveLabelCount()).toBe(1);
        a.release();
        expect(liveLabelCount()).toBe(1);
        b.release();
        expect(liveLabelCount()).toBe(0);
    });

    it("keeps distinct texts separate", async () => {
        const { acquireLabel, liveLabelCount } = await import("./textures");
        const a = acquireLabel("1", "#000", "#fff", 64, 32);
        const b = acquireLabel("2", "#000", "#fff", 64, 32);
        expect(a.tex).not.toBe(b.tex);
        expect(liveLabelCount()).toBe(2);
        a.release();
        b.release();
        expect(liveLabelCount()).toBe(0);
    });
});
