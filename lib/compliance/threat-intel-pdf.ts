import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { type ThreatIntelRecord, type ThreatIntelStats } from "@/lib/threat-intel";

export interface IsoPdfOptions {
  siteName: string;
  year?: number;
  stats: ThreatIntelStats;
}

const COLORS = {
  headerBg: [15, 23, 42] as [number, number, number], // Slate 900
  accent: [13, 148, 136] as [number, number, number], // Teal 600
  cardBg: [248, 250, 252] as [number, number, number], // Slate 50
  cardBorder: [226, 232, 240] as [number, number, number], // Slate 200
  textDark: [15, 23, 42] as [number, number, number],
  textMuted: [100, 116, 139] as [number, number, number],
  critical: [220, 38, 38] as [number, number, number],
  high: [234, 88, 12] as [number, number, number],
  success: [16, 185, 129] as [number, number, number],
  warning: [217, 119, 6] as [number, number, number],
};

function formatShortDate(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function generateIso27001ThreatIntelPdf(
  items: ThreatIntelRecord[],
  options: IsoPdfOptions
) {
  const { siteName, stats, year = new Date().getFullYear() } = options;

  // Landscape A4: 297mm x 210mm
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = 297;
  const pageHeight = 210;
  const margin = 12;

  // 1. Header Banner
  doc.setFillColor(...COLORS.headerBg);
  doc.rect(0, 0, pageWidth, 24, "F");

  // Accent line
  doc.setFillColor(...COLORS.accent);
  doc.rect(0, 24, pageWidth, 1.5, "F");

  // Header Titles
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("ISO/IEC 27001:2022 ISMS AUDIT COMPLIANCE REPORT", margin, 9);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225); // Slate 300
  doc.text(
    "Control A.5.7 (Threat Intelligence) & Control A.8.8 (Management of Technical Vulnerabilities)",
    margin,
    16
  );
  doc.text(
    `Scope: ${siteName} | Reporting Year: ${year}`,
    margin,
    21
  );

  // Security Classification on top right
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(239, 68, 68); // Red 500
  doc.text("CONFIDENTIAL // FOR AUDIT PURPOSES ONLY", pageWidth - margin, 9, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text(`Generated: ${new Date().toLocaleString("en-GB")}`, pageWidth - margin, 15, { align: "right" });
  doc.text(`Doc ID: ISO27001-TI-${year}-${Date.now().toString().slice(-4)}`, pageWidth - margin, 20, { align: "right" });

  // 2. Executive KPI Summary Cards
  const kpiTop = 29;
  const cardWidth = (pageWidth - margin * 2 - 12) / 4;
  const cardHeight = 16;

  const kpis = [
    {
      label: "TOTAL THREATS IDENTIFIED",
      val: String(stats.total),
      sub: "Tracked from external advisories",
      color: COLORS.textDark,
    },
    {
      label: "MITIGATION COMPLIANCE RATE",
      val: `${stats.mitigationRate}%`,
      sub: `${stats.mitigated + stats.notApplicableOrAccepted} of ${stats.total} resolved / verified`,
      color: stats.mitigationRate >= 80 ? COLORS.success : COLORS.warning,
    },
    {
      label: "ACTIVE EXPOSURE (OPEN)",
      val: String(stats.open + stats.inProgress),
      sub: `${stats.open} Open • ${stats.inProgress} In Remediation`,
      color: stats.open + stats.inProgress > 0 ? COLORS.critical : COLORS.success,
    },
    {
      label: "CRITICAL / HIGH SEVERITY",
      val: String(stats.criticalHigh),
      sub: "CVSS score >= 7.0 (High Priority)",
      color: stats.criticalHigh > 0 ? COLORS.critical : COLORS.textMuted,
    },
  ];

  kpis.forEach((kpi, idx) => {
    const x = margin + idx * (cardWidth + 4);
    doc.setFillColor(...COLORS.cardBg);
    doc.setDrawColor(...COLORS.cardBorder);
    doc.roundedRect(x, kpiTop, cardWidth, cardHeight, 1.5, 1.5, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.textMuted);
    doc.text(kpi.label, x + 3, kpiTop + 4.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...kpi.color);
    doc.text(kpi.val, x + 3, kpiTop + 10.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(...COLORS.textMuted);
    doc.text(kpi.sub, x + 3, kpiTop + 14.5);
  });

  // 3. Vulnerability & Mitigation Register Table
  const tableTop = kpiTop + cardHeight + 4;

  const tableData = items.map((item, idx) => {
    const cveText = item.cveList ? `\nCVE: ${item.cveList}` : "";
    const cvssText = item.cvssScore !== null ? ` (CVSS: ${item.cvssScore})` : "";
    const titleAndCve = `${item.title}${cvssText}${cveText}`;

    const assetDesc = item.deviceName
      ? `${item.affectedAsset}\n[Device: ${item.deviceName}]`
      : item.affectedAsset;

    const evidenceText =
      item.evidences && item.evidences.length > 0
        ? `Verified (${item.evidences.length} files)`
        : "None attached";

    return [
      String(idx + 1),
      formatShortDate(item.intelDate),
      item.source,
      titleAndCve,
      assetDesc,
      item.status.toUpperCase().replace("_", " "),
      formatShortDate(item.mitigatedAt),
      item.mitigationAction || "Pending mitigation",
      evidenceText,
    ];
  });

  autoTable(doc, {
    startY: tableTop,
    head: [
      [
        "No",
        "Intel Date",
        "Source",
        "Vulnerability & CVE Reference",
        "Affected Asset",
        "Status",
        "Mitigated Date",
        "Mitigation / Patch Action Taken",
        "Evidence Status",
      ],
    ],
    body: tableData,
    margin: { left: margin, right: margin, bottom: 35 },
    theme: "striped",
    headStyles: {
      fillColor: COLORS.headerBg,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 7.5,
      cellPadding: 2,
    },
    bodyStyles: {
      fontSize: 6.8,
      textColor: COLORS.textDark,
      cellPadding: 2,
      valign: "middle",
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" }, // No
      1: { cellWidth: 20 }, // Intel Date
      2: { cellWidth: 24 }, // Source
      3: { cellWidth: 62 }, // Vulnerability & CVE
      4: { cellWidth: 42 }, // Affected Asset
      5: { cellWidth: 22, halign: "center", fontStyle: "bold" }, // Status
      6: { cellWidth: 20 }, // Mitigated Date
      7: { cellWidth: 50 }, // Mitigation Action
      8: { cellWidth: 25, halign: "center" }, // Evidence
    },
    didParseCell: (data) => {
      // Color status cells
      if (data.section === "body" && data.column.index === 5) {
        const val = String(data.cell.raw).toLowerCase();
        if (val.includes("mitigated")) {
          data.cell.styles.textColor = [16, 185, 129];
        } else if (val.includes("in progress")) {
          data.cell.styles.textColor = [37, 99, 235];
        } else if (val.includes("open")) {
          data.cell.styles.textColor = [220, 38, 38];
        }
      }
    },
  });

  // 4. Auditor Sign-Off Section (always place at bottom of the last page or add page if tight)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastAutoTable = (doc as any).lastAutoTable;
  let finalY = lastAutoTable ? lastAutoTable.finalY + 6 : tableTop + 20;

  // If not enough room for sign-off box (needs 24mm), add a new page
  if (finalY + 26 > pageHeight - 12) {
    doc.addPage();
    finalY = 20;
  }

  // Sign-Off Container
  const signWidth = (pageWidth - margin * 2 - 10) / 3;
  const signHeight = 22;

  const signBlocks = [
    { title: "PREPARED BY (OPERATIONS / ANALYST)", role: "IT Security Operations" },
    { title: "REVIEWED BY (INFRASTRUCTURE LEAD)", role: "IT Infrastructure Manager" },
    { title: "VERIFIED & APPROVED BY (LEAD AUDITOR)", role: "ISO 27001 Lead Auditor / MR" },
  ];

  signBlocks.forEach((block, idx) => {
    const x = margin + idx * (signWidth + 5);
    doc.setFillColor(...COLORS.cardBg);
    doc.setDrawColor(...COLORS.cardBorder);
    doc.roundedRect(x, finalY, signWidth, signHeight, 1, 1, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.2);
    doc.setTextColor(...COLORS.textMuted);
    doc.text(block.title, x + 3, finalY + 4);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.text(`Role: ${block.role}`, x + 3, finalY + 7.5);

    doc.setFontSize(5.5);
    doc.text("Signature & Date:", x + 3, finalY + 12);
    doc.setDrawColor(...COLORS.cardBorder);
    doc.line(x + 20, finalY + 18, x + signWidth - 4, finalY + 18);
  });

  // 5. Running Footer on all pages
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.textMuted);

    // Left
    doc.text(
      "ISO/IEC 27001:2022 Annex A.5.7 & A.8.8 Verification • Codex-Infra Compliance Ledger",
      margin,
      pageHeight - 5
    );

    // Center
    doc.text("CONFIDENTIAL - RESTRICTED DISTRIBUTION", pageWidth / 2, pageHeight - 5, { align: "center" });

    // Right
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 5, { align: "right" });
  }

  // Save PDF
  const safeSite = siteName.replace(/[^a-zA-Z0-9_-]/g, "_");
  doc.save(`ISO27001_Threat_Intelligence_${safeSite}_${year}.pdf`);
}
