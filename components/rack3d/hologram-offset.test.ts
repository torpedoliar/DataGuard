import { describe, expect, it } from "vitest";
import { hologramStagger, type HologramAnchor } from "./hologram-offset";

// Same location + same rack unless a test says otherwise.
const at = (u: number | null, over: Partial<HologramAnchor> = {}): HologramAnchor =>
  ({ locationName: "Room A", rackName: "R1", u, ...over });

describe("hologramStagger", () => {
  it("pushes the lower U down and the higher U up for adjacent units in one rack", () => {
    expect(hologramStagger(at(10), at(11))).toEqual({ base: 9, peer: -9 });
  });

  it("leaves both alone when the units are far apart in the same rack", () => {
    expect(hologramStagger(at(10), at(20))).toEqual({ base: 0, peer: 0 });
  });

  it("leaves both alone in a different rack or a different location", () => {
    expect(hologramStagger(at(10), at(11, { rackName: "R2" }))).toEqual({ base: 0, peer: 0 });
    expect(hologramStagger(at(10), at(11, { locationName: "Room B" }))).toEqual({ base: 0, peer: 0 });
  });

  it("leaves both alone when either rack name is unknown", () => {
    expect(hologramStagger(at(10, { rackName: null }), at(11))).toEqual({ base: 0, peer: 0 });
    expect(hologramStagger(at(10), at(11, { rackName: null }))).toEqual({ base: 0, peer: 0 });
  });

  it("puts the base below the peer when the base sits higher", () => {
    expect(hologramStagger(at(12), at(11))).toEqual({ base: -9, peer: 9 });
  });

  it("puts the base above the peer when both units are equal", () => {
    expect(hologramStagger(at(10), at(10))).toEqual({ base: -9, peer: 9 });
  });

  it("assumes the unknown side is the higher one", () => {
    expect(hologramStagger(at(null), at(null))).toEqual({ base: -9, peer: 9 });
    expect(hologramStagger(at(null), at(11))).toEqual({ base: -9, peer: 9 });
    expect(hologramStagger(at(10), at(null))).toEqual({ base: 9, peer: -9 });
  });

  it("treats U0 or a negative U as unknown", () => {
    expect(hologramStagger(at(0), at(11))).toEqual({ base: -9, peer: 9 });
    expect(hologramStagger(at(-3), at(11))).toEqual({ base: -9, peer: 9 });
  });

  it("applies the same rules after the proximity gate, not instead of it", () => {
    // Unknown on both sides is still not a reason to shift across racks.
    expect(hologramStagger(at(null), at(null, { rackName: "R2" }))).toEqual({ base: 0, peer: 0 });
  });
});
