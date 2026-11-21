import { describe, expect, it } from "vitest";
import { epdrLocalClock, formatEpdrDateTime, isValidEpdrTimeZone, resolveEpdrTimeZone } from "./time-zone";

describe("EPDR explicit timezones", () => {
  it.each(["UTC", "Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "America/New_York", "Etc/GMT+7"])("accepts IANA %s", (zone) => {
    expect(isValidEpdrTimeZone(zone)).toBe(true);
  });
  it.each([null, undefined, "", " UTC", "UTC ", "+07:00", "WIB", "Not/AZone", "a".repeat(101)])("rejects invalid %s", (zone) => {
    expect(isValidEpdrTimeZone(zone)).toBe(false);
  });
  it("resolves personal before browser, with deterministic UTC fallback", () => {
    expect(resolveEpdrTimeZone("Asia/Jayapura", "Asia/Jakarta")).toBe("Asia/Jayapura");
    expect(resolveEpdrTimeZone(null, "Asia/Jakarta")).toBe("Asia/Jakarta");
    expect(resolveEpdrTimeZone(null, "bad")).toBe("UTC");
  });
  it("uses local calendar dates near UTC midnight", () => {
    expect(epdrLocalClock(new Date("2030-01-01T20:00:00Z"), "Asia/Jakarta")).toEqual({ day: "2030-01-02", hour: 3 });
  });
  it("requires explicit valid zones and formats deterministic wall times", () => {
    expect(formatEpdrDateTime("2030-01-01T00:00:00Z", "Asia/Jakarta")).toContain("07:00");
    expect(formatEpdrDateTime("invalid", "UTC")).toBe("—");
    expect(() => formatEpdrDateTime(0, "invalid")).toThrow("invalid_epdr_time_zone");
  });
});
