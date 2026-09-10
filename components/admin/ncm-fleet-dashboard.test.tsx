import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NcmFleetDashboard from "./ncm-fleet-dashboard";
import type { FleetSnapshot } from "@/lib/ncm-fleet";

// Static-markup render test: the client component is presentational (takes
// one FleetSnapshot), so we assert the badge/table contract directly.
const SNAPSHOT: FleetSnapshot = {
  sites: [
    { siteId: 1, siteName: "DC-JKT", configured: true, status: "online", lastSeenAt: new Date("2026-09-10T00:00:00Z"), reachable: true, error: null, openDriftCount: 2 },
    { siteId: 2, siteName: "DC-SBY", configured: true, status: "offline", lastSeenAt: null, reachable: false, error: "Gagal terhubung", openDriftCount: 0 },
    { siteId: 3, siteName: "DC-NEW", configured: false, status: null, lastSeenAt: null, reachable: false, error: null, openDriftCount: 0 },
  ],
  drifts: [
    { siteId: 1, siteName: "DC-JKT", reviewId: "11", switchLabel: "core-1", status: "pending", createdAt: "2026-09-10T01:02:03Z" },
  ],
  offlineCount: 1,
  openDriftTotal: 2,
  checkedAt: "2026-09-10T01:00:00.000Z",
};

describe("NcmFleetDashboard", () => {
  it("renders per-site badges, the aggregate header, and the drift table", () => {
    const html = renderToStaticMarkup(React.createElement(NcmFleetDashboard, { snapshot: SNAPSHOT }));
    // Aggregate header
    expect(html).toContain("1 site offline");
    expect(html).toContain("2 drift terbuka");
    // Site badges
    expect(html).toContain("DC-JKT");
    expect(html).toContain("online");
    expect(html).toContain("DC-SBY");
    expect(html).toContain("tidak terjangkau");
    expect(html).toContain("belum dikonfigurasi");
    // Drift row with link to the site NCM page
    expect(html).toContain("#11");
    expect(html).toContain("core-1");
    expect(html).toContain("/admin/ncm");
  });

  it("renders the empty states without crashing", () => {
    const html = renderToStaticMarkup(
      React.createElement(NcmFleetDashboard, {
        snapshot: { sites: [], drifts: [], offlineCount: 0, openDriftTotal: 0, checkedAt: "2026-09-10T01:00:00.000Z" },
      }),
    );
    expect(html).toContain("Belum ada site aktif");
    expect(html).toContain("Tidak ada review drift terbuka lintas site");
  });
});
