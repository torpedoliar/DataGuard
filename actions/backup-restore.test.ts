import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  verifySession: vi.fn(),
}));

import { verifySession } from "@/lib/session";
import { requireSuperadmin } from "./backup-restore";

describe("requireSuperadmin", () => {
  it("returns ok when role is superadmin", async () => {
    (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      role: "superadmin", userId: 1, username: "root", isAuth: true, activeSiteId: null, activeSiteName: null,
    });
    const result = await requireSuperadmin();
    expect(result.ok).toBe(true);
  });

  it("rejects admins", async () => {
    (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      role: "admin", userId: 2, username: "a", isAuth: true, activeSiteId: 1, activeSiteName: "Site",
    });
    const result = await requireSuperadmin();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("rejects when session missing", async () => {
    (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const result = await requireSuperadmin();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });
});
