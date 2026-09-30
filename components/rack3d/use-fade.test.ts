import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyFade } from "./use-fade";

const mat = (opacity: number) => new THREE.MeshStandardMaterial({ opacity, transparent: opacity < 1 });

describe("applyFade", () => {
  it("restores a filter-muted device to its muted opacity, not to 1 (focus rack then Esc)", () => {
    const m = mat(0.12);
    applyFade(m, true);
    applyFade(m, false);
    expect(m.opacity).toBeCloseTo(0.12);
    expect(m.transparent).toBe(true);
  });

  it("round-trips an opaque material back to opaque", () => {
    const m = mat(1);
    applyFade(m, true);
    expect(m.opacity).toBeCloseTo(0.15);
    applyFade(m, false);
    expect(m.opacity).toBe(1);
    expect(m.transparent).toBe(false);
  });

  it("leaves React-driven device materials alone (they fold the fade into their opacity prop)", () => {
    const m = mat(0.12);
    m.userData.ownFade = true;
    applyFade(m, true);
    expect(m.opacity).toBeCloseTo(0.12);
    applyFade(m, false);
    expect(m.opacity).toBeCloseTo(0.12);
  });

  it("is idempotent and skips shared LED materials", () => {
    const m = mat(1);
    applyFade(m, true);
    applyFade(m, true);
    expect(m.opacity).toBeCloseTo(0.15);
    const led = mat(1);
    led.userData.shared = true;
    applyFade(led, true);
    expect(led.opacity).toBe(1);
  });
});
