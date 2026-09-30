import { describe, expect, it } from "vitest";
import { initialQuality, resolveQuality, stepDown } from "./quality";

describe("initialQuality", () => {
  it("starts discrete GPUs on high", () => {
    expect(initialQuality("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)", false)).toBe("high");
    expect(initialQuality("ANGLE (AMD, AMD Radeon RX 6600 Direct3D11)", false)).toBe("high");
  });

  it("starts integrated GPUs on medium", () => {
    expect(initialQuality("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)", false)).toBe("medium");
    expect(initialQuality("ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)", false)).toBe("medium");
  });

  it("starts phones and tablets on low", () => {
    expect(initialQuality("Apple GPU", true)).toBe("low");
  });
});

describe("stepDown / resolveQuality", () => {
  it("steps down to low and stays there", () => {
    expect(stepDown("high")).toBe("medium");
    expect(stepDown("medium")).toBe("low");
    expect(stepDown("low")).toBe("low");
  });

  it("uses the manual setting unless auto", () => {
    expect(resolveQuality("auto", "medium")).toBe("medium");
    expect(resolveQuality("low", "high")).toBe("low");
  });
});
