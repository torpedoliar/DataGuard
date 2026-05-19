import { describe, expect, it } from "vitest";
import { getChecklistStatusTone, getIncidentSeverityTone, getIncidentStatusTone } from "./status";

describe("status tone helpers", () => {
  it("maps checklist statuses to stable tones", () => {
    expect(getChecklistStatusTone("OK")).toBe("success");
    expect(getChecklistStatusTone("Warning")).toBe("warning");
    expect(getChecklistStatusTone("Error")).toBe("danger");
    expect(getChecklistStatusTone("Unknown")).toBe("neutral");
  });

  it("maps incident severities to stable tones", () => {
    expect(getIncidentSeverityTone("Low")).toBe("neutral");
    expect(getIncidentSeverityTone("Medium")).toBe("warning");
    expect(getIncidentSeverityTone("High")).toBe("orange");
    expect(getIncidentSeverityTone("Critical")).toBe("danger");
  });

  it("maps incident workflow statuses to stable tones", () => {
    expect(getIncidentStatusTone("Open")).toBe("info");
    expect(getIncidentStatusTone("In Progress")).toBe("accent");
    expect(getIncidentStatusTone("Resolved")).toBe("purple");
    expect(getIncidentStatusTone("Verified")).toBe("success");
  });
});
