import { describe, expect, it } from "vitest";
import { ceilingLights } from "./ceiling-lights";

describe("ceiling light placement", () => {
    const bounds = { minX: 3, maxX: 18, minZ: -16, maxZ: 2 };
    it.each([["low", 1], ["medium", 4], ["high", 6]] as const)(
        "uses actual fixture locations at %s quality", (quality, count) => {
            const fixtures = ceilingLights(bounds);
            const sources = ceilingLights(bounds, quality);
            expect(sources).toHaveLength(count);
            for (const source of sources) expect(fixtures).toContainEqual(source);
        },
    );
    it("centres a single fixture in a room narrower than the fixture spacing", () => {
        expect(ceilingLights({ minX: 2, maxX: 3, minZ: 4, maxZ: 6 })).toEqual([[2.5, 5]]);
    });
});
