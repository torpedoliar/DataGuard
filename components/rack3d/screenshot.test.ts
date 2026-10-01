import { describe, expect, it } from "vitest";
import { screenshotFooter, screenshotName } from "./screenshot";

const at = new Date(Date.UTC(2026, 9, 1, 4, 30));

describe("screenshot naming", () => {
  it("builds a safe file name from the room and UTC time", () => {
    expect(screenshotName("DC Room A", at)).toBe("rack3d-dc-room-a-202610010430.png");
    expect(screenshotName("  !!  ", at)).toBe("rack3d-room-202610010430.png");
  });
  it("puts room, site and time in the footer", () => {
    const f = screenshotFooter("DC Room A", "Data Center Jakarta", at);
    expect(f.startsWith("DC Room A · Data Center Jakarta · ")).toBe(true);
    expect(f).toMatch(/2026/);
  });
});
