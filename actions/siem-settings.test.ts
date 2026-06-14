import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock action-auth so the SUT does not require a live session. The mocked
// guard always succeeds with a stable activeSiteId=1.
vi.mock("@/lib/action-auth", () => ({
  requireActiveSiteAdminAction: async () => ({
    ok: true,
    session: { userId: 1, username: "u", role: "admin" } as never,
    activeSiteId: 1,
  }),
}));

const logAuditMock = vi.fn();
vi.mock("@/lib/audit", () => ({
  logAudit: (...args: unknown[]) => logAuditMock(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const findFirstMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();

vi.mock("@/db", () => ({
  db: {
    query: { siemRules: { findFirst: (..._args: unknown[]) => findFirstMock() } },
    update: (..._args: unknown[]) => ({
      set: (..._args: unknown[]) => {
        updateSetMock(..._args);
        return { where: (..._args: unknown[]) => updateWhereMock(..._args) };
      },
    }),
  },
}));

import { updateSiemRuleDetail } from "./siem-settings";

function makeFormData(values: Record<string, string | number>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.append(key, String(value));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  updateWhereMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("updateSiemRuleDetail", () => {
  it("updates rule detail fields and audits when the rule exists", async () => {
    findFirstMock.mockResolvedValueOnce({ id: 7, key: "auth_failed_burst" });

    const result = await updateSiemRuleDetail(
      undefined,
      makeFormData({
        id: "7",
        name: "Auth failed burst (low noise)",
        description: "5 failed auth events in 60s",
        severity: "Medium",
        category: "Authentication",
        threshold: "5",
        windowSeconds: "60",
        conditions: '{"srcIp": true}',
      }),
    );

    expect(result).toMatchObject({ success: true });
    expect(updateSetMock).toHaveBeenCalledTimes(1);
    const setArg = updateSetMock.mock.calls[0][0];
    expect(setArg).toMatchObject({
      name: "Auth failed burst (low noise)",
      description: "5 failed auth events in 60s",
      severity: "Medium",
      category: "Authentication",
      threshold: 5,
      windowSeconds: 60,
      conditions: { srcIp: true },
    });
    expect(setArg.updatedAt).toBeInstanceOf(Date);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "UPDATE",
        entity: "settings",
        entityName: "SIEM Rule",
        entityId: 7,
        detail: expect.stringContaining("Auth failed burst (low noise)"),
      }),
    );
  });

  it("clears threshold/window/conditions when the form values are blank", async () => {
    findFirstMock.mockResolvedValueOnce({ id: 9, key: "k" });

    const result = await updateSiemRuleDetail(
      undefined,
      makeFormData({
        id: "9",
        name: "Renamed",
        description: "",
        severity: "Low",
        category: "Other",
        threshold: "",
        windowSeconds: "",
        conditions: "",
      }),
    );

    expect(result).toMatchObject({ success: true });
    const setArg = updateSetMock.mock.calls[0][0];
    expect(setArg.threshold).toBeNull();
    expect(setArg.windowSeconds).toBeNull();
    expect(setArg.conditions).toEqual({});
  });

  it("rejects invalid severity without writing to the db", async () => {
    const result = await updateSiemRuleDetail(
      undefined,
      makeFormData({
        id: "7",
        name: "x",
        description: "y",
        severity: "Bogus",
        category: "z",
        threshold: "",
        windowSeconds: "",
        conditions: "",
      }),
    );
    expect(result).toMatchObject({ errors: expect.any(Object) });
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("rejects non-JSON conditions without writing to the db", async () => {
    const result = await updateSiemRuleDetail(
      undefined,
      makeFormData({
        id: "7",
        name: "x",
        description: "y",
        severity: "High",
        category: "z",
        threshold: "",
        windowSeconds: "",
        conditions: "{not json",
      }),
    );
    expect(result).toMatchObject({ errors: expect.any(Object) });
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("returns an error when the rule is not found", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    const result = await updateSiemRuleDetail(
      undefined,
      makeFormData({
        id: "404",
        name: "x",
        description: "y",
        severity: "High",
        category: "z",
        threshold: "",
        windowSeconds: "",
        conditions: "",
      }),
    );
    expect(result).toEqual({ message: "SIEM rule not found." });
    expect(updateSetMock).not.toHaveBeenCalled();
  });
});
