import { describe, expect, it } from "vitest";
import { buildIsolationPayload, buildThreatSyncActionPayload, clampExecutionMode, isAdvancedAction } from "./advanced-actions";

describe("advanced actions", () => {
  it("identifies advanced actions and clamps them to approval (simulate stays simulate)", () => {
    expect(isAdvancedAction("isolate")).toBe(true);
    expect(isAdvancedAction("ts_quarantine")).toBe(true);
    expect(isAdvancedAction("scan")).toBe(false);

    expect(clampExecutionMode("isolate", "automatic")).toBe("approval");
    expect(clampExecutionMode("ts_block_ip", "approval")).toBe("approval");
    expect(clampExecutionMode("scan", "automatic")).toBe("automatic");
    expect(clampExecutionMode("isolate", "simulate")).toBe("simulate");
  });

  it("builds typed payloads from stored data only", () => {
    expect(buildIsolationPayload(["d-1"])).toEqual({ device_ids: ["d-1"], customized_message: null });
    expect(buildThreatSyncActionPayload("quarantineFile", { entityId: "e", parameters: { md5: "m" } })).toEqual({ command: "quarantineFile", entity_id: "e", parameters: { md5: "m" } });
  });
});