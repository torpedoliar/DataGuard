import { describe, expect, it } from "vitest";
import { peerBadgeSide } from "./game-cards";

describe("peerBadgeSide", () => {
    it("puts the peer badge on the opposite side of the device card", () => {
        expect(peerBadgeSide("right")).toBe("left");
        expect(peerBadgeSide("left")).toBe("right");
    });
});
