import { describe, expect, it } from "vitest";
import {
  EXCLUDED_OPERATIONS,
  THREATSYNC_COMMANDS,
  WRITE_OPERATIONS,
  describeWriteAction,
  getWriteOperation,
  isWriteActionType,
  unsupportedActionReason,
} from "./execution-capability";

describe("write operation registry", () => {
  it("separates Endpoint Security device actions from ThreatSync entity actions", () => {
    for (const operation of WRITE_OPERATIONS) {
      if (operation.namespace === "endpoint_security") {
        expect(operation.path.startsWith("/devices") || operation.path === "/immediatescan" ||
          operation.path.startsWith("/managedconfigurations")).toBe(true);
      } else {
        expect(operation.path.startsWith("/actions") || operation.path.startsWith("/incidents")).toBe(true);
      }
    }
  });

  it("never uses the endpoint-security isolation endpoint for a ThreatSync action", () => {
    expect(getWriteOperation("threatsync", "isolate")).toBeNull();
    expect(getWriteOperation("endpoint_security", "ts_isolate")).toBeNull();
  });

  it("resolves the exact documented methods and paths", () => {
    expect(getWriteOperation("endpoint_security", "scan")).toMatchObject({ method: "POST", path: "/immediatescan" });
    expect(getWriteOperation("endpoint_security", "isolate")).toMatchObject({ method: "POST", path: "/devices/isolation" });
    expect(getWriteOperation("endpoint_security", "unisolate")).toMatchObject({ method: "POST", path: "/devices/noisolation" });
    expect(getWriteOperation("endpoint_security", "reboot")).toMatchObject({ method: "POST", path: "/devices/action" });
    expect(getWriteOperation("endpoint_security", "assign_config")).toMatchObject({
      method: "PATCH",
      path: "/managedconfigurations/2/{configId}",
    });
    expect(getWriteOperation("threatsync", "ts_quarantine")).toMatchObject({ method: "POST", path: "/actions" });
    expect(getWriteOperation("threatsync", "ts_incident_status")).toMatchObject({
      method: "PATCH",
      path: "/incidents/{providerIncidentId}",
    });
  });

  it("maps every ThreatSync command to its documented provider name", () => {
    expect(THREATSYNC_COMMANDS).toEqual({
      ts_isolate: "isolate",
      ts_unisolate: "unIsolate",
      ts_kill_process: "killProcess",
      ts_quarantine: "quarantineFile",
      ts_block_ip: "blockAddress",
      ts_unblock_ip: "unblockAddress",
    });
  });

  it("reports high-impact operations so approval cannot be skipped silently", () => {
    expect(describeWriteAction("isolate")).toMatchObject({ highImpact: true, reversible: "separate_request" });
    expect(describeWriteAction("scan")).toMatchObject({ highImpact: false });
    // Only isolation has an in-app inverse; a reboot or killed process cannot be undone.
    expect(describeWriteAction("reboot")).toMatchObject({ reversible: "not_reversible" });
    expect(describeWriteAction("ts_kill_process")).toMatchObject({ reversible: "not_reversible" });
  });

  it("distinguishes verified completion reads from manual review", () => {
    expect(describeWriteAction("scan")).toMatchObject({ observationSupport: "automatic" });
    expect(describeWriteAction("reboot")).toMatchObject({ observationSupport: "manual_review" });
    expect(describeWriteAction("ts_incident_status")).toMatchObject({ observationSupport: "manual_review" });
  });

  it("refuses actions that have no verified contract", () => {
    expect(isWriteActionType("uninstall")).toBe(false);
    expect(unsupportedActionReason("uninstall")).toBeTruthy();
    expect(unsupportedActionReason("repair")).toBeTruthy();
    expect(unsupportedActionReason("scan")).toBeNull();
    expect(EXCLUDED_OPERATIONS.map((entry) => entry.action)).toContain("transact");
  });
});
