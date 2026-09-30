import { describe, expect, it } from "vitest";
import { PRESETS, QUALITY_LABELS, QUALITY_SETTINGS, initialQuality, parseQualitySetting, resolveQuality } from "./quality";

describe("initialQuality", () => {
  it("starts discrete GPUs on high", () => {
    expect(initialQuality("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)", false)).toBe("high");
    expect(initialQuality("ANGLE (AMD, AMD Radeon RX 6600 Direct3D11)", false)).toBe("high");
  });

  it("starts integrated GPUs on medium", () => {
    expect(initialQuality("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)", false)).toBe("medium");
    expect(initialQuality("ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)", false)).toBe("medium");
  });

  it("starts software renderers and phones/tablets on low", () => {
    expect(initialQuality("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)", false)).toBe("low");
    expect(initialQuality("Microsoft Basic Render Driver", false)).toBe("low");
    expect(initialQuality("llvmpipe (LLVM 15.0.7, 256 bits)", false)).toBe("low");
    expect(initialQuality("Apple GPU", true)).toBe("low");
  });
});

describe("resolveQuality", () => {
  it("uses the manual setting unless auto", () => {
    expect(resolveQuality("auto", "medium")).toBe("medium");
    expect(resolveQuality("low", "high")).toBe("low");
    expect(resolveQuality("high", "low")).toBe("high");
  });
});

describe("parseQualitySetting", () => {
  it("accepts the four settings and falls back to auto for anything else", () => {
    for (const q of QUALITY_SETTINGS) expect(parseQualitySetting(q)).toBe(q);
    expect(parseQualitySetting(null)).toBe("auto");
    expect(parseQualitySetting("ultra")).toBe("auto");
    expect(parseQualitySetting("")).toBe("auto");
  });
});

describe("PRESETS", () => {
  it("never gets cheaper going up a level", () => {
    const cost = (q: keyof typeof PRESETS) => Object.values(PRESETS[q]).filter((v) => v === true).length + PRESETS[q].dpr[1];
    expect(cost("low")).toBeLessThan(cost("medium"));
    expect(cost("medium")).toBeLessThan(cost("high"));
  });

  it("keeps effects that need the composer consistent", () => {
    for (const p of Object.values(PRESETS)) {
      if (p.ao || p.dof) expect(p.bloom).toBe(true); // ao/dof live inside the composer path
      if (p.softShadows) expect(p.shadows).toBe(true);
    }
  });

  it("labels every setting", () => {
    for (const q of QUALITY_SETTINGS) expect(QUALITY_LABELS[q]).toMatch(/\w/);
  });
});
