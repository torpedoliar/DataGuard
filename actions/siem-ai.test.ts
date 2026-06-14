import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock action-auth so the SUT does not require a live session. The mocked
// guard always succeeds with a stable activeSiteId.
vi.mock("@/lib/action-auth", () => ({
  requireActiveSiteAdminAction: async () => ({
    ok: true,
    session: { userId: 1, username: "u", role: "admin" } as never,
    activeSiteId: 1,
  }),
}));

// Mock audit so we don't hit the DB.
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

// Mock the db module with a fluent chain. The same `selectMock` is reused for
// every call; each test stubs its own return shape via `mockReturnValueOnce`.
// We also need a default that returns a chain that resolves to an empty
// settings row, so un-stubbed calls don't throw.
const selectMock = vi.fn();
const findFirstMock = vi.fn();
const defaultSelectChain = () => {
  const limit = vi.fn().mockResolvedValue([{ aiEnabled: false }]);
  const from = vi.fn().mockReturnValue({ limit });
  return { from };
};
vi.mock("@/db", () => ({
  db: {
    select: (..._args: unknown[]) => selectMock() ?? defaultSelectChain(),
    query: { siemFindings: { findFirst: (..._a: unknown[]) => findFirstMock() } },
  },
}));

// Mock the queue helper to assert cooldown short-circuit vs. fallback.
const mockGenerate = vi.fn();
vi.mock("@/lib/siem/ai-queue", () => ({
  generateSiemAiAnalysisForFinding: (...args: unknown[]) => mockGenerate(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { generateSiemAiAnalysis } from "./siem-ai";

function makeSelectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ limit });
  return { from };
}

function makeFormData(values: Record<string, string | number>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) {
    fd.append(key, String(value));
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerate.mockReset();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("generateSiemAiAnalysis", () => {
  it("generates analysis when the finding is cold (no aiGeneratedAt)", async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 10,
      siteId: 1,
      aiGeneratedAt: null,
    });
    selectMock.mockReturnValueOnce(makeSelectChain([{ aiEnabled: true, aiRegenerateCooldownSec: 3600 }]));
    mockGenerate.mockResolvedValueOnce({ ok: true });

    const result = await generateSiemAiAnalysis(undefined, makeFormData({ id: "10" }));
    expect(result).toEqual({ success: true });
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("blocks regeneration within the cooldown window and returns cooldownRemainingSec", async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    findFirstMock.mockResolvedValueOnce({
      id: 11,
      siteId: 1,
      aiGeneratedAt: tenMinutesAgo,
    });
    selectMock.mockReturnValueOnce(makeSelectChain([{ aiEnabled: true, aiRegenerateCooldownSec: 3600 }]));

    const result = await generateSiemAiAnalysis(undefined, makeFormData({ id: "11" }));
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      message: expect.stringMatching(/cooldown/i),
      cooldownRemainingSec: expect.any(Number),
      cooldownSec: 3600,
    });
    // Roughly the remaining time — 1h - 10m, allow a 30s skew.
    const remaining = (result as { cooldownRemainingSec: number }).cooldownRemainingSec;
    expect(remaining).toBeGreaterThan(2970);
    expect(remaining).toBeLessThanOrEqual(3000);
  });

  it("regenerates analysis when the cooldown has elapsed", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    findFirstMock.mockResolvedValueOnce({
      id: 12,
      siteId: 1,
      aiGeneratedAt: twoHoursAgo,
    });
    selectMock.mockReturnValueOnce(makeSelectChain([{ aiEnabled: true, aiRegenerateCooldownSec: 3600 }]));
    mockGenerate.mockResolvedValueOnce({ ok: true });

    const result = await generateSiemAiAnalysis(undefined, makeFormData({ id: "12" }));
    expect(result).toEqual({ success: true });
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("falls back to the 3600s default when settings omit the cooldown column", async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    findFirstMock.mockResolvedValueOnce({
      id: 13,
      siteId: 1,
      aiGeneratedAt: fiveMinutesAgo,
    });
    // No aiRegenerateCooldownSec in the row (DB predates the column, or row
    // was inserted with explicit NULL handling): the action should treat
    // undefined as 3600.
    selectMock.mockReturnValueOnce(makeSelectChain([{ aiEnabled: true }]));

    const result = await generateSiemAiAnalysis(undefined, makeFormData({ id: "13" }));
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ cooldownSec: 3600 });
  });
});
