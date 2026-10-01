import { describe, expect, it } from "vitest";
import { portFace, type PortFaceInput } from "./port-face";

const dev = (extra: Partial<PortFaceInput> = {}): PortFaceInput => ({
  faceplatePortCount: null,
  faceplateUplinkCount: null,
  faceplateRows: null,
  faceplateNumbering: null,
  ports: [],
  ...extra,
});
const port = (id: number, portName: string, status: string | null = "Active", mediaType: string | null = null) =>
  ({ id, portName, portIndex: null, mediaType, status });

describe("portFace", () => {
  it("returns null when the device has no faceplate configured (caller keeps the default face)", () => {
    expect(portFace(dev({ ports: [port(1, "1")] }), 0.04)).toBeNull();
  });

  it("lays out exactly the configured access + uplink ports", () => {
    const face = portFace(dev({ faceplatePortCount: 8, faceplateUplinkCount: 2, faceplateRows: 2 }), 0.04)!;
    expect(face.slots.filter((s) => !s.uplink)).toHaveLength(8);
    expect(face.slots.filter((s) => s.uplink)).toHaveLength(2);
  });

  it("blinks only Active ports; Inactive/Down/undocumented are dark", () => {
    const face = portFace(dev({
      faceplatePortCount: 4,
      faceplateRows: 1,
      ports: [port(1, "1", "Active"), port(2, "2", "Inactive"), port(3, "3", "Down")],
    }), 0.04)!;
    expect(face.slots.map((s) => s.state)).toEqual(["active", "inactive", "down", "empty"]);
  });

  it("fits the ports inside the faceplate width and the device height", () => {
    const face = portFace(dev({ faceplatePortCount: 48, faceplateUplinkCount: 4, faceplateRows: 2 }), 0.04)!;
    for (const s of face.slots) {
      // right of the name tag/logo, left of the status LED
      expect(s.x - s.w / 2).toBeGreaterThanOrEqual(-0.0101);
      expect(s.x + s.w / 2).toBeLessThanOrEqual(0.1951);
      expect(Math.abs(s.y) + s.h / 2).toBeLessThanOrEqual(0.02);
    }
  });

  it("keeps slot left-to-right order across the face (access before uplinks)", () => {
    const face = portFace(dev({ faceplatePortCount: 4, faceplateUplinkCount: 2, faceplateRows: 1 }), 0.04)!;
    const xs = face.slots.map((s) => s.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it("gives ports varied blink phases so a switch does not flash in unison", () => {
    const face = portFace(dev({
      faceplatePortCount: 12,
      faceplateRows: 1,
      ports: Array.from({ length: 12 }, (_, i) => port(i + 1, String(i + 1))),
    }), 0.04)!;
    expect(new Set(face.slots.map((s) => s.phase)).size).toBeGreaterThan(1);
  });
});
