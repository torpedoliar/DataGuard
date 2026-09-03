import * as XLSX from "xlsx";
import { type ThreatIntelRecord } from "@/lib/threat-intel";

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function exportThreatIntelToExcel(
  items: ThreatIntelRecord[],
  siteName: string = "All Sites",
  year: number = new Date().getFullYear()
) {
  // Title row
  const title = `THREAT INTELLIGENCE ${year} - ISO/IEC 27001:2022 (A.5.7 & A.8.8)`;
  const subtitle = `Site Scope: ${siteName} | Generated: ${new Date().toLocaleString("en-GB")}`;

  // Headers matching user's spreadsheet
  const headers = [
    "Tanggal Informasi Threat Intelligence",
    "Sumber",
    "Deskripsi Kerentanan",
    "Asset Yang Terdampak",
    "Tanggal Mitigasi",
    "Patching / Tindakan Mitigasi",
    "Bukti",
  ];

  const rows = items.map((item) => {
    // Format vulnerability description
    const cvePart = item.cveList ? `[${item.cveList}]` : "";
    const cvssPart = item.cvssScore ? `(CVSS: ${item.cvssScore})` : "";
    const descParts = [
      item.title,
      cvePart,
      cvssPart,
      item.description || "",
    ].filter(Boolean).join(" - ");

    // Format asset
    const assetPart = item.deviceName
      ? `${item.affectedAsset} (Device: ${item.deviceName})`
      : item.affectedAsset;

    // Format source
    const sourcePart = item.sourceUrl
      ? `${item.source} (${item.sourceUrl})`
      : item.source;

    // Format evidence info
    const evidencePart =
      item.evidences && item.evidences.length > 0
        ? `${item.evidences.length} lampiran: ${item.evidences
            .map((e) => e.caption || e.fileName || "Screenshot")
            .join(", ")}`
        : "Tidak ada lampiran";

    return [
      formatDate(item.intelDate),
      sourcePart,
      descParts,
      assetPart,
      item.mitigatedAt ? formatDate(item.mitigatedAt) : "-",
      item.mitigationAction || "-",
      evidencePart,
    ];
  });

  const sheetData = [
    [title],
    [subtitle],
    [],
    headers,
    ...rows,
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Column widths
  ws["!cols"] = [
    { wch: 28 }, // Tanggal Informasi
    { wch: 30 }, // Sumber
    { wch: 55 }, // Deskripsi Kerentanan
    { wch: 35 }, // Asset Yang Terdampak
    { wch: 28 }, // Tanggal Mitigasi
    { wch: 45 }, // Patching / Tindakan
    { wch: 35 }, // Bukti
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Threat Intel ${year}`);

  const safeSite = siteName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `Threat_Intelligence_${safeSite}_${year}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
