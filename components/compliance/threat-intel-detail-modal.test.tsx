import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ThreatIntelDetailModal from "./threat-intel-detail-modal";
import { type ThreatIntelRecord } from "@/lib/threat-intel";

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
  createdAt: new Date("2026-01-07T10:00:00Z"),
  updatedAt: new Date("2026-01-08T10:00:00Z"),
  evidences: [
    {
      id: 101,
      threatIntelId: 1,
      filePath: "/uploads/threat-intel/evidence-1.png",
      fileName: "email-screenshot.png",
      fileSize: 10240,
      mimeType: "image/png",
      caption: "Vendor notification",
      createdAt: new Date("2026-01-08T10:00:00Z"),
    },
  ],
};

vi.mock("@/components/ui/modal", () => ({
  Modal: ({
    open,
    children,
    title,
    description,
    footer,
  }: {
    open: boolean;
    children: React.ReactNode;
    title: string;
    description?: string;
    footer?: React.ReactNode;
  }) => {
    if (!open) return null;
    return (
      <div data-testid="mock-modal" aria-label={title}>
        <div>{description}</div>
        {children}
        {footer}
      </div>
    );
  },
}));

describe("ThreatIntelDetailModal", () => {

  it("returns null when open is false", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThreatIntelDetailModal, {
        item: mockItem,
        open: false,
        onClose: () => {},
      })
    );
    expect(html).toBe("");
  });

  it("returns null when item is null", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThreatIntelDetailModal, {
        item: null,
        open: true,
        onClose: () => {},
      })
    );
    expect(html).toBe("");
  });

  it("renders full case details when open is true", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThreatIntelDetailModal, {
        item: mockItem,
        open: true,
        onClose: () => {},
        onEdit: () => {},
        onViewPhoto: () => {},
      })
    );

    // Header & Badges
    expect(html).toContain("Veeam Backup &amp; Replication RCE");
    expect(html).toContain("CVSS 8.7");
    expect(html).toContain("ISO/IEC 27001:2022 Control A.5.7");

    // Source & CVE links
    expect(html).toContain("The Hacker News");
    expect(html).toContain("https://thehackernews.com/advisory");
    expect(html).toContain("https://nvd.nist.gov/vuln/detail/CVE-2025-59168");
    expect(html).toContain("https://nvd.nist.gov/vuln/detail/CVE-2025-59469");

    // Asset & Infrastructure
    expect(html).toContain("Veeam Backup &amp; Replication SJA");
    expect(html).toContain("DC - Sepanjang");
    expect(html).toContain("SRV-BACKUP-01");

    // Technical Description
    expect(html).toContain("RCE vulnerability via postgres parameter");

    // Mitigation
    expect(html).toContain("Patching to 13.0.1.1071");

    // Evidence
    expect(html).toContain("Vendor notification");
    expect(html).toContain("/uploads/threat-intel/evidence-1.png");

    // Action Buttons
    expect(html).toContain("Edit Advisory");
    expect(html).toContain("Tutup");
  });

  it("handles missing sourceUrl and empty evidence gracefully", () => {
    const itemWithoutUrlOrEvidence: ThreatIntelRecord = {
      ...mockItem,
      id: 2,
      sourceUrl: null,
      evidences: [],
      mitigationAction: null,
      cveList: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(ThreatIntelDetailModal, {
        item: itemWithoutUrlOrEvidence,
        open: true,
        onClose: () => {},
      })
    );

    expect(html).toContain("Belum ada lampiran bukti foto");
    expect(html).toContain("Tidak ada referensi CVE spesifik");
    expect(html).toContain("Belum ada catatan rencana mitigasi");
  });
});
