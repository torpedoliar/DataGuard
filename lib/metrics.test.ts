import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockVerifySession = vi.fn();
const mockCollectMetrics = vi.fn();

vi.mock("@/lib/session", () => ({
  verifySession: (...args: unknown[]) => mockVerifySession(...args),
}));

vi.mock("@/lib/action-auth", () => ({
  requireSuperadminAction: async () => {
    const session = await mockVerifySession();
    if (!session || session.role !== "superadmin") {
      return { ok: false, message: "Unauthorized. Superadmin access required." };
    }
    return { ok: true, session, activeSiteId: session.activeSiteId ?? 0 };
  },
}));

vi.mock("@/lib/metrics", () => ({
  collectMetrics: (...args: unknown[]) => mockCollectMetrics(...args),
}));

import { GET } from "@/app/api/metrics/route";

describe("GET /api/metrics", () => {
  beforeEach(() => {
    mockVerifySession.mockReset();
    mockCollectMetrics.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no session is present", async () => {
    mockVerifySession.mockResolvedValueOnce(null);

    const res = await GET();
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body).toHaveProperty("message");
    expect(mockCollectMetrics).not.toHaveBeenCalled();
  });

  it("returns 401 when the user is not a superadmin", async () => {
    mockVerifySession.mockResolvedValueOnce({
      userId: 2, username: "u", role: "admin", activeSiteId: 1, activeSiteName: "s", isAuth: true, expiresAt: new Date(),
    });

    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockCollectMetrics).not.toHaveBeenCalled();
  });

  it("returns 200 with the expected shape when authed as superadmin", async () => {
    mockVerifySession.mockResolvedValueOnce({
      userId: 1, username: "root", role: "superadmin", activeSiteId: null, activeSiteName: null, isAuth: true, expiresAt: new Date(),
    });

    const fixAt = new Date("2026-06-14T10:00:00Z");
    mockCollectMetrics.mockResolvedValueOnce({
      siem: {
        alerts: { queued: 4, sent: 17, failed: 1 },
        retention: { lastRunAt: fixAt.toISOString() },
        partition: { lastEnsureRunAt: fixAt.toISOString() },
      },
      backup: { lastBackupAt: fixAt.toISOString(), lastRestoreAt: fixAt.toISOString() },
      health: { dbOk: true, appUptimeSec: 123 },
      timestamp: "2026-06-14T10:00:01.000Z",
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      siem: {
        alerts: { queued: 4, sent: 17, failed: 1 },
        retention: { lastRunAt: fixAt.toISOString() },
        partition: { lastEnsureRunAt: fixAt.toISOString() },
      },
      backup: { lastBackupAt: fixAt.toISOString(), lastRestoreAt: fixAt.toISOString() },
      health: { dbOk: true, appUptimeSec: 123 },
    });
    expect(typeof body.timestamp).toBe("string");
    expect(mockCollectMetrics).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when collectMetrics throws", async () => {
    mockVerifySession.mockResolvedValueOnce({
      userId: 1, username: "root", role: "superadmin", activeSiteId: null, activeSiteName: null, isAuth: true, expiresAt: new Date(),
    });
    mockCollectMetrics.mockRejectedValueOnce(new Error("db down"));

    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.siem.alerts).toEqual({ queued: null, sent: null, failed: null });
    expect(body.siem.retention).toEqual({ lastRunAt: null });
    expect(body.siem.partition).toEqual({ lastEnsureRunAt: null });
    expect(body.backup).toEqual({ lastBackupAt: null, lastRestoreAt: null });
    expect(body.health.dbOk).toBe(false);
  });
});
