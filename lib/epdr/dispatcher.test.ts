import { describe, expect, it } from "vitest";
import { buildEndpointActionPayload, buildScanPayload, formatProviderDuration } from "./dispatcher";
import { WatchGuardError } from "@/lib/watchguard/errors";

describe("formatProviderDuration", () => {
  it("formats 24h as 1.00:00:00 and shorter windows with zero-padding", () => {
    expect(formatProviderDuration(24)).toBe("1.00:00:00");
    expect(formatProviderDuration(1)).toBe("0.01:00:00");
    expect(formatProviderDuration(1.5)).toBe("0.01:30:00");
    expect(formatProviderDuration(48)).toBe("2.00:00:00");
  });
});

describe("buildScanPayload", () => {
  it("builds a full-system scan payload with scope 0 and 24h window", () => {
    const payload = buildScanPayload({ deviceIds: ["d-1"], taskName: "dc-check action:u incident:9" });
    expect(payload).toMatchObject({
      device_ids: ["d-1"],
      scan_scope: 0,
      detect_hacking_tools: true,
      detect_suspicious_files: true,
      scan_compressed_files: true,
      execution_window_expiration: "1.00:00:00",
    });
  });
});

describe("buildEndpointActionPayload", () => {
  it("builds scan and reboot payloads, and blocks unsupported types", () => {
    const endpoint = { wgDeviceId: "d-1", incidentId: 9 };
    expect(buildEndpointActionPayload("scan", { scanScope: 0, windowHours: 24 }, endpoint)).toMatchObject({ scan_scope: 0 });
    expect(buildEndpointActionPayload("reboot", {}, endpoint)).toMatchObject({ action_type: 1, count_down_type: 7 });

    expect(() => buildEndpointActionPayload("isolate", {}, endpoint)).toThrowError(WatchGuardError);
  });
});