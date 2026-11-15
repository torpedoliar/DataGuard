import { describe, expect, it } from "vitest";
import { handoffSeverity, incidentHandoffSchema } from "./incident-handoff";

const input = { detectionId: 1, assigneeId: null, picGroupId: null, note: "Review this detection" };
describe("explicit local Incident handoff input", () => {
  it("keeps assignee and PIC independent and optional", () => {
    expect(incidentHandoffSchema.parse(input)).toEqual(input);
    expect(incidentHandoffSchema.parse({ ...input, assigneeId: 9, picGroupId: 12 })).toMatchObject({ assigneeId: 9, picGroupId: 12 });
  });
  it.each([{ note: " " }, { note: "x".repeat(501) }, { detectionId: -1 }, { detectionId: 1.5 }, { assigneeId: 0 }, { picGroupId: -2 }, { siteId: 99 }, { providerAction: "scan" }])("rejects invalid or authority-bearing fields %j", (patch) => {
    expect(incidentHandoffSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it.each(["Low", "Medium", "High", "Critical"])("preserves local severity %s", (severity) => {
    expect(handoffSeverity(severity)).toBe(severity);
  });
  it("does not map an arbitrary provider string to critical priority", () => {
    expect(handoffSeverity("urgent-provider-code")).toBe("Medium");
  });
});
