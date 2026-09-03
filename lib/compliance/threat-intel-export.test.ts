import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { exportThreatIntelToExcel } from "./threat-intel-export";
import { generateIso27001ThreatIntelPdf } from "./threat-intel-pdf";
import { type ThreatIntelRecord } from "@/lib/threat-intel";

vi.mock("xlsx", () => ({
  utils: {
    aoa_to_sheet: vi.fn(() => ({})),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
}));

const mockSave = vi.fn();

vi.mock("jspdf", () => {
  const MockClass = vi.fn(function () {
    return {
      setFillColor: vi.fn(),
      rect: vi.fn(),
      setTextColor: vi.fn(),
      setFont: vi.fn(),
      setFontSize: vi.fn(),
      text: vi.fn(),
      setDrawColor: vi.fn(),
      roundedRect: vi.fn(),
      line: vi.fn(),
      addPage: vi.fn(),
      setPage: vi.fn(),
      getNumberOfPages: vi.fn().mockReturnValue(1),
      save: mockSave,
    };
  });
  return { default: MockClass };
});

vi.mock("jspdf-autotable", () => ({
  default: vi.fn(),
}));

const mockItems: ThreatIntelRecord[] = [
  {
    id: 1,
    siteId: 1,
    siteName: "DC - Sepanjang",
    deviceId: 10,
    deviceName: "SRV-BACKUP",
    intelDate: new Date("2026-01-07"),
    source: "The Hacker News",
    sourceUrl: "https://thehackernews.com",
    title: "Veeam Vulnerability",
    cveList: "CVE-2025-59168",
    cvssScore: 8.7,
    severity: "high",
    description: "RCE vulnerability",
    affectedAsset: "Veeam Backup SJA",
    status: "mitigated",
    mitigatedAt: new Date("2026-01-08"),
    mitigationAction: "Patch 13.0.1",
    createdById: 1,
    createdByName: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    evidences: [],
  },
];

describe("Threat Intelligence Exports", () => {
  it("exportThreatIntelToExcel formats data and calls writeFile", () => {
    exportThreatIntelToExcel(mockItems, "DC - Sepanjang", 2026);

    expect(XLSX.utils.aoa_to_sheet).toHaveBeenCalled();
    expect(XLSX.utils.book_new).toHaveBeenCalled();
    expect(XLSX.utils.book_append_sheet).toHaveBeenCalled();
    expect(XLSX.writeFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("Threat_Intelligence_DC_-_Sepanjang_2026.xlsx")
    );
  });

  it("generateIso27001ThreatIntelPdf generates document and calls save", () => {
    generateIso27001ThreatIntelPdf(mockItems, {
      siteName: "DC - Sepanjang",
      year: 2026,
      stats: {
        total: 1,
        open: 0,
        inProgress: 0,
        mitigated: 1,
        notApplicableOrAccepted: 0,
        criticalHigh: 1,
        mitigationRate: 100,
      },
    });

    expect(jsPDF).toHaveBeenCalled();
    expect(autoTable).toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalled();
  });
});
