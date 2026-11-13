import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { EpdrSecurityContext } from "@/actions/epdr-endpoints";
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/components/ui/action-button", () => ({ default: () => null }));
import { ConnectionGate, FreshnessWarning } from "./security-chrome";

const context: EpdrSecurityContext = {
  siteName: "Test site", connection: "syncing_first", lastSyncAt: null,
  lastSyncError: null, isAdmin: true, isSuperadmin: true,
};

describe("first sync messaging", () => {
  it("does not claim an absent timestamp is an actively running sync", async () => {
    const html = renderToStaticMarkup(await ConnectionGate({ context }));
    expect(html).toContain("setup.firstSyncTitle");
    expect(html).not.toContain("animate-spin");
  });

  it("shows a failed first attempt even without successful sync data", async () => {
    const html = renderToStaticMarkup(await FreshnessWarning({ context: { ...context, connection: "error", lastSyncError: "auth" }, locale: "en" }));
    expect(html).toContain("setup.errorTitle");
    expect(html).toContain("setup.errorBody");
  });
});
