import { describe, expect, it } from "vitest";
import { cardAnchorPosition } from "./device-card-anchor";

describe("cardAnchorPosition", () => {
    it("sits above the device face, clear of the chassis and slid-out face", () => {
        // 1U device at U18: top of chassis must be below the anchor.
        const y = cardAnchorPosition(18, 1);
        expect(y).toBeGreaterThan(18 * 0.04445 + 0.04445 / 2);
        // 2U device anchor sits higher than the 1U anchor at the same base.
        expect(cardAnchorPosition(18, 2)).toBeGreaterThan(y);
    });
});
