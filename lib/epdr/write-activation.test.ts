import { describe, expect, it } from "vitest";
import { DEFAULT_WRITE_ACTIONS, resolveRequestedActions, widenActions } from "./write-activation";

describe("EPDR write activation", () => {
  it("defaults to the per-device Endpoint Security actions", () => {
    expect(resolveRequestedActions(undefined)).toEqual({
      requested: [...DEFAULT_WRITE_ACTIONS],
      unknown: [],
    });
  });

  it("trims, de-duplicates and validates requested actions", () => {
    expect(resolveRequestedActions(" scan, isolate ,scan,ts_quarantine ")).toEqual({
      requested: ["scan", "isolate", "ts_quarantine"],
      unknown: [],
    });
  });

  it("rejects actions without a verified provider contract", () => {
    expect(resolveRequestedActions("scan,uninstall_protection,repair")).toEqual({
      requested: ["scan", "uninstall_protection", "repair"],
      unknown: ["uninstall_protection", "repair"],
    });
  });

  it("widens allowlists without removing or duplicating existing actions", () => {
    expect(widenActions(["scan", "isolate"], ["isolate", "reboot"]))
      .toEqual(["isolate", "reboot", "scan"]);
    expect(widenActions([], ["scan"])).toEqual(["scan"]);
  });

  it("keeps an empty request empty rather than treating it as all actions", () => {
    expect(resolveRequestedActions(" , ")).toEqual({ requested: [], unknown: [] });
    expect(widenActions(["scan"], [])).toEqual(["scan"]);
  });
});
