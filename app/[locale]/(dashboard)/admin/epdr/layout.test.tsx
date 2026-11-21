import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), zone: vi.fn() }));
vi.mock("@/lib/session", () => ({ verifySession: mocks.session }));
vi.mock("@/lib/site-access", () => ({ requireSiteAccess: mocks.access }));
vi.mock("@/lib/epdr/display-time-zone", () => ({ loadEpdrDisplayTimeZone: mocks.zone }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/components/admin/epdr/time-zone-provider", () => ({ EpdrTimeZoneProvider: "provider" }));
vi.mock("@/components/admin/epdr/time-zone-selector", () => ({ TimeZoneSelector: "selector" }));
import EpdrLayout from "./layout";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId: 4, activeSiteId: 2 });
  mocks.access.mockResolvedValue(true);
  mocks.zone.mockResolvedValue({ personalTimeZone: null, siteTimeZone: "Asia/Jakarta", timeZone: "Asia/Jakarta" });
});
describe("EPDR shared display clock", () => {
  it("resolves preferences only after site membership", async () => {
    const result = await EpdrLayout({ children: "content" });
    expect(mocks.zone).toHaveBeenCalledWith(4, 2);
    expect(result.props).toMatchObject({ initialTimeZone: null, siteTimeZone: "Asia/Jakarta" });
    expect(result.key).toBe("2");
  });
  it("does not load preferences for revoked site membership", async () => {
    mocks.access.mockResolvedValue(false);
    await expect(EpdrLayout({ children: null })).rejects.toThrow("redirect:/select-site");
    expect(mocks.zone).not.toHaveBeenCalled();
  });
  it("requires authentication before access or preferences", async () => {
    mocks.session.mockResolvedValue(null);
    await expect(EpdrLayout({ children: null })).rejects.toThrow("redirect:/login");
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.zone).not.toHaveBeenCalled();
  });
});
