import { describe, expect, it } from "vitest";
import { isWatchGuardRegion, regionHost, WATCHGUARD_REGIONS } from "./regions";

describe("WATCHGUARD_REGIONS", () => {
  it("exposes exactly the three documented regional hosts", () => {
    expect(WATCHGUARD_REGIONS).toEqual({
      jpn: "api.jpn.cloud.watchguard.com",
      deu: "api.deu.cloud.watchguard.com",
      usa: "api.usa.cloud.watchguard.com",
    });
  });

  it("resolves a region to its host", () => {
    expect(regionHost("jpn")).toBe("api.jpn.cloud.watchguard.com");
    expect(regionHost("deu")).toBe("api.deu.cloud.watchguard.com");
    expect(regionHost("usa")).toBe("api.usa.cloud.watchguard.com");
  });

  it("recognizes valid region keys and rejects free-form hosts", () => {
    expect(isWatchGuardRegion("jpn")).toBe(true);
    expect(isWatchGuardRegion("deu")).toBe(true);
    expect(isWatchGuardRegion("usa")).toBe(true);
    expect(isWatchGuardRegion("api.jpn.cloud.watchguard.com")).toBe(false);
    expect(isWatchGuardRegion("eu")).toBe(false);
    expect(isWatchGuardRegion(null)).toBe(false);
  });
});