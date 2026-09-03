import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ThreatIntelKpi from "./threat-intel-kpi";
import ThreatIntelTable from "./threat-intel-table";
import { type ThreatIntelRecord, type ThreatIntelStats } from "@/lib/threat-intel";

const mockStats: ThreatIntelStats = {
  total: 5,
  open: 1,
  inProgress: 1,
  mitigated: 3,
  notApplicableOrAccepted: 0,
  criticalHigh: 2,
  mitigationRate: 60,
};

const mockItem: ThreatIntelRecord = {
  id: 1,
  siteId: 1,
  siteName: "DC - Sepanjang",
  deviceId: 10,
  deviceName: "SRV-BACKUP-01",
  intelDate: new Date("2026-01-07"),
  source: "The Hacker News",
  sourceUrl: "https://thehackernews.com/advisory",
  title: "Veeam Backup & Replication RCE",
  cveList: "CVE-2025-59168, CVE-2025-59469",
  cvssScore: 8.7,
  severity: "high",
  description: "RCE vulnerability via postgres parameter",
  affectedAsset: "Veeam Backup & Replication SJA",
  status: "mitigated",
  mitigatedAt: new Date("2026-01-08"),
  mitigationAction: "Patching to 13.0.1.1071",
  createdById: 1,
  createdByName: "admin",
  createdAt: new Date(),
  updatedAt: new Date(),
  evidences: [
    {
      id: 101,
      threatIntelId: 1,
      filePath: "/uploads/threat-intel/evidence-1.png",
      fileName: "email-screenshot.png",
      fileSize: 10240,
      mimeType: "image/png",
      caption: "Vendor notification",
      createdAt: new Date(),
    },
  ],
};

describe("Threat Intelligence Components", () => {
  it("renders KPI cards with correct stats", () => {
    const html = renderToStaticMarkup(React.createElement(ThreatIntelKpi, { stats: mockStats }));

    expect(html).toContain("Total Threats Tracked");
    expect(html).toContain("5");
    expect(html).toContain("60%");
    expect(html).toContain("Mitigation Rate");
    expect(html).toContain("Active Threats");
  });

  it("renders empty state in table when items list is empty", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThreatIntelTable, {
        items: [],
        onEdit: () => {},
        onDelete: () => {},
        onViewPhoto: () => {},
      })
    );

    expect(html).toContain("Belum ada data Threat Intelligence");
    expect(html).toContain("Tanggal Info");
    expect(html).toContain("Sumber");
    expect(html).toContain("Deskripsi Kerentanan");
    expect(html).toContain("Asset Terdampak");
  });

  it("renders table row with CVE, CVSS, asset, and evidence thumbnail", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThreatIntelTable, {
        items: [mockItem],
        onEdit: () => {},
        onDelete: () => {},
        onViewPhoto: () => {},
      })
    );

    expect(html).toContain("Veeam Backup &amp; Replication RCE");
    expect(html).toContain("CVE-2025-59168");
    expect(html).toContain("CVE-2025-59469");
    expect(html).toContain("CVSS: 8.7");
    expect(html).toContain("Veeam Backup &amp; Replication SJA");
    expect(html).toContain("Patching to 13.0.1.1071");
    expect(html).toContain("The Hacker News");
    expect(html).toContain("/uploads/threat-intel/evidence-1.png");
  });
});
