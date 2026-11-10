import { describe, expect, it } from "vitest";
import { advanceHealthStage, classifyHealth, OFFLINE_FREEZE_DAYS, type HealthSettings } from "./health";

const settings: HealthSettings = { graceMinutes: 30, stageWaitMinutes: 1440, stableMinutes: 60, rebootMode: "approval" };

describe("classifyHealth", () => {
  it("maps protection status to problem", () => {
    expect(classifyHealth({ accumulatedProtectionStatus: 1, protectionEngineUpdateStatus: 0, knowledgeCatalogUpdateStatus: 0, rebootRequested: false, lastConnectionAt: new Date() }, Date.now()).problem).toBe("none");
    expect(classifyHealth({ accumulatedProtectionStatus: 2, protectionEngineUpdateStatus: 0, knowledgeCatalogUpdateStatus: 0, rebootRequested: false, lastConnectionAt: null }, Date.now()).problem).toBe("disabled");
    expect(classifyHealth({ accumulatedProtectionStatus: 3, protectionEngineUpdateStatus: 0, knowledgeCatalogUpdateStatus: 0, rebootRequested: false, lastConnectionAt: null }, Date.now()).problem).toBe("error");
    expect(classifyHealth({ accumulatedProtectionStatus: 4, protectionEngineUpdateStatus: 0, knowledgeCatalogUpdateStatus: 0, rebootRequested: false, lastConnectionAt: null }, Date.now()).problem).toBe("install_error");
    expect(classifyHealth({ accumulatedProtectionStatus: 5, protectionEngineUpdateStatus: 0, knowledgeCatalogUpdateStatus: 0, rebootRequested: false, lastConnectionAt: null }, Date.now()).problem).toBe("no_license");
    expect(classifyHealth({ accumulatedProtectionStatus: 99, protectionEngineUpdateStatus: 0, knowledgeCatalogUpdateStatus: 0, rebootRequested: false, lastConnectionAt: null }, Date.now()).problem).toBe("unknown_status");
  });

  it("flags pending restart and outdated over an activated status", () => {
    expect(classifyHealth({ accumulatedProtectionStatus: 1, protectionEngineUpdateStatus: 3, knowledgeCatalogUpdateStatus: 0, rebootRequested: false, lastConnectionAt: null }, Date.now()).problem).toBe("pending_restart");
    expect(classifyHealth({ accumulatedProtectionStatus: 1, protectionEngineUpdateStatus: 0, knowledgeCatalogUpdateStatus: 1, rebootRequested: false, lastConnectionAt: null }, Date.now()).problem).toBe("outdated");
  });

  it("freezes offline endpoints", () => {
    const old = new Date(Date.now() - (OFFLINE_FREEZE_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(classifyHealth({ accumulatedProtectionStatus: 3, protectionEngineUpdateStatus: 0, knowledgeCatalogUpdateStatus: 0, rebootRequested: false, lastConnectionAt: old }, Date.now()).offline).toBe(true);
  });
});

describe("advanceHealthStage", () => {
  it("holds during grace then proposes reboot/escalates", () => {
    const open = { stage: 0, stageChangedAt: new Date(Date.now() - 31 * 60 * 1000), healthySince: null, currentProblem: "pending_restart" as const };
    const result = advanceHealthStage({ problem: "pending_restart", offline: false, rebootFlag: true }, open, settings, Date.now());
    expect(result.nextStage).toBe(1);
    expect(result.action.kind).toBe("propose_reboot");
  });

  it("escalates to stage 2 when no reboot is flagged or policy is off", () => {
    const open = { stage: 0, stageChangedAt: new Date(Date.now() - 31 * 60 * 1000), healthySince: null, currentProblem: "error" as const };
    const result = advanceHealthStage({ problem: "error", offline: false, rebootFlag: false }, open, settings, Date.now());
    expect(result.nextStage).toBe(2);
    expect(result.action.kind).toBe("escalate");
  });

  it("does not advance an offline endpoint", () => {
    const open = { stage: 2, stageChangedAt: new Date(1), healthySince: null, currentProblem: "error" as const };
    const result = advanceHealthStage({ problem: "error", offline: true, rebootFlag: false }, open, settings, Date.now());
    expect(result.action.kind).toBe("hold");
    expect(result.nextStage).toBe(2);
  });

  it("closes only after stable healthy duration", () => {
    const open = { stage: 2, stageChangedAt: new Date(1), healthySince: new Date(Date.now() - 61 * 60 * 1000), currentProblem: "error" as const };
    const result = advanceHealthStage({ problem: "none", offline: false, rebootFlag: false }, open, settings, Date.now());
    expect(result.action.kind).toBe("close");
  });
});