import { describe, expect, it } from "vitest";
import { BULK_PORT_NAMING_TEMPLATES, buildPortNameRange, formatPortName } from "./network-port-naming";

describe("network port naming templates", () => {
  it("formats gigabit interface names", () => {
    expect(formatPortName("gigabit", { slot: "1", subslot: "0", port: "24" })).toBe("Gi1/0/24");
  });

  it("builds interface ranges", () => {
    expect(buildPortNameRange("gigabit", { slot: "1", subslot: "0" }, 1, 3)).toEqual([
      "Gi1/0/1",
      "Gi1/0/2",
      "Gi1/0/3",
    ]);
  });

  it("rejects invalid ranges", () => {
    expect(() => buildPortNameRange("gigabit", { slot: "1", subslot: "0" }, 5, 3)).toThrow("Invalid port range");
  });

  it("rejects ranges over 100 ports", () => {
    expect(() => buildPortNameRange("ethernet", {}, 1, 102)).toThrow("Maximum 100 ports");
  });

  it("rejects blank custom names", () => {
    expect(() => formatPortName("custom", { customName: "   " })).toThrow("Port name is required");
  });

  it("rejects missing slot/subslot for templates that require them", () => {
    expect(() => formatPortName("gigabit", { port: "1" })).toThrow("Slot is required");
  });
  it("excludes custom names from bulk templates", () => {
    expect(BULK_PORT_NAMING_TEMPLATES.map((template) => template.id)).not.toContain("custom");
  });
});

