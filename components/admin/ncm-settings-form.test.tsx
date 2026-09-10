import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The client form posts via useActionState (no-op in static render); what we
// assert is the ticket-14 UI contract: one card per site containing URL+key,
// Network Docs, the 1-click CTA, the scope list, and no manual URL typing.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("react", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react")>();
  return { ...mod, useActionState: () => [undefined, () => undefined, false] };
});

import NcmSettingsForm from "./ncm-settings-form";

const PROPS = {
  initialData: {
    sites: [
      { siteId: 1, siteName: "DC-JKT", url: "http://10.0.0.9:9443", apiKeyConfigured: true, webhookUrl: "", webhookConfigured: false, lastSeenAt: null, status: null },
    ],
    sitesWithoutConfig: [],
  },
  networkDoc: {
    sites: [{ siteId: 1, siteName: "DC-JKT", url: "", apiKeyConfigured: false, usesEnvDefault: false, effectiveUrl: "http://10.0.0.9:9443" }],
    workerIntervalMs: null,
    envOverridesInterval: false,
    envHasUrl: false,
    envHasKey: false,
    sitesWithoutConfig: [],
  },
} as never;

describe("NcmSettingsForm (ticket 14 unified)", () => {
  const html = renderToStaticMarkup(React.createElement(NcmSettingsForm, PROPS));

  it("renders one connection block per site with URL + key + Network Docs", () => {
    expect(html).toContain("DC-JKT");
    expect(html).toContain("ncmUrl");
    expect(html).toContain("ncmAdminApiKey");
    expect(html).toContain("Network Docs Sync");
    expect(html).toContain("networkDocSiteId");
  });

  it("makes the 1-click HMAC setup the primary CTA, manual fields collapsed in advanced", () => {
    expect(html).toContain("Aktifkan Webhook (1 klik)");
    expect(html).toContain("<details");
    expect(html.indexOf("Aktifkan Webhook (1 klik)")).toBeLessThan(html.indexOf("<details"));
  });

  it("shows the required scope list + legacy-key guidance", () => {
    expect(html).toContain("system:write");
    expect(html).toContain("API Keys NCM");
  });

  it("renders the global network-doc interval picker", () => {
    expect(html).toContain("networkDocIntervalMs");
  });
});
