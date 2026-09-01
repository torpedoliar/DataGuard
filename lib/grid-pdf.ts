import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface DailyCheckSummary {
    status: string;
    username?: string;
    checker?: string;
    time?: string;
    shift?: string;
}

export interface GridDeviceRow {
    id: number;
    name: string;
    categoryName?: string | null;
    categoryColor?: string | null;
    rackName?: string | null;
    rackPosition?: number | null;
    locationName?: string | null;
    statusHistory: Record<string, DailyCheckSummary[]>;
}

export interface GridExportKpis {
    totalDevices: number;
    totalChecks: number;
    okChecks: number;
    notOkChecks: number;
    coveragePct: number;
    devicesWithIssue: number;
}

export interface GridCategorySummary {
    category: string;
    total: number;
    notOk: number;
}

export interface RawGridExportData {
    dates: string[];
    gridData: GridDeviceRow[];
    kpis: GridExportKpis;
    categories: GridCategorySummary[];
    roomTempByDate?: Record<string, string[]>;
    siteName?: string;
    siteCode?: string;
}

// Executive Color Palette
const COLORS = {
    headerBg: [15, 23, 42] as [number, number, number],        // Slate 900 #0f172a
    headerSub: [148, 163, 184] as [number, number, number],    // Slate 400 #94a3b8
    cardBg: [248, 250, 252] as [number, number, number],       // Slate 50 #f8fafc
    cardBorder: [226, 232, 240] as [number, number, number],   // Slate 200 #e2e8f0
    textDark: [15, 23, 42] as [number, number, number],        // Slate 900
    textMuted: [100, 116, 139] as [number, number, number],    // Slate 500
    gridLine: [226, 232, 240] as [number, number, number],

    // Accents
    primary: [79, 70, 229] as [number, number, number],        // Indigo #4f46e5
    emerald: [16, 185, 129] as [number, number, number],       // Emerald #10b981
    emeraldBg: [209, 250, 229] as [number, number, number],    // Emerald 100
    rose: [239, 68, 68] as [number, number, number],           // Rose #ef4444
    roseBg: [254, 226, 226] as [number, number, number],       // Rose 100
    amber: [245, 158, 11] as [number, number, number],         // Amber #f59e0b
    amberBg: [254, 243, 199] as [number, number, number],      // Amber 100
    cyan: [6, 182, 212] as [number, number, number],           // Cyan #06b6d4
};

export function buildAuditGridPdf(
    data: RawGridExportData,
    options?: { statusFilter?: string; siteName?: string }
): jsPDF {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth(); // 297mm
    const pageHeight = doc.internal.pageSize.getHeight(); // 210mm
    const margin = 12;
    const usableW = pageWidth - margin * 2; // 273mm

    const siteLabel = options?.siteName || data.siteName || "Data Center Facility";
    const statusFilter = options?.statusFilter && options.statusFilter !== "All" ? options.statusFilter : "All";
    const periodStart = data.dates[0] ?? "-";
    const periodEnd = data.dates[data.dates.length - 1] ?? "-";

    // ==========================================
    // 1. EXECUTIVE HEADER BANNER (Top 22mm)
    // ==========================================
    const bannerH = 22;
    doc.setFillColor(...COLORS.headerBg);
    doc.rect(0, 0, pageWidth, bannerH, "F");

    // Accent line at bottom of header
    doc.setFillColor(...COLORS.primary);
    doc.rect(0, bannerH - 1.2, pageWidth, 1.2, "F");

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text("DATA CENTER AUDIT & COMPLIANCE DASHBOARD", margin, 10.5);

    // Subtitle
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.headerSub);
    doc.text(`${siteLabel.toUpperCase()}  |  OPERATIONAL INFRASTRUCTURE AUDIT REPORT`, margin, 16.5);

    // Right-aligned Metadata Chips
    const chipY = 6.5;
    const chipH = 8.5;
    
    // Period Chip
    const periodText = `Period: ${periodStart} to ${periodEnd}`;
    doc.setFontSize(7.5);
    const periodW = doc.getTextWidth(periodText) + 8;
    const periodX = pageWidth - margin - periodW;

    doc.setFillColor(30, 41, 59); // Slate 800
    doc.roundedRect(periodX, chipY, periodW, chipH, 1.5, 1.5, "F");
    doc.setTextColor(226, 232, 240);
    doc.text(periodText, periodX + 4, chipY + 5.5);

    // Devices & Filter Chip
    const devText = `${data.gridData.length} Devices · Filter: ${statusFilter}`;
    const devW = doc.getTextWidth(devText) + 8;
    const devX = periodX - devW - 4;

    doc.setFillColor(30, 41, 59);
    doc.roundedRect(devX, chipY, devW, chipH, 1.5, 1.5, "F");
    doc.setTextColor(148, 163, 184);
    doc.text(devText, devX + 4, chipY + 5.5);

    // ==========================================
    // 2. MODERN KPI HERO TILES (6 Cards)
    // ==========================================
    const kpiY = bannerH + 5; // 27mm
    const kpiH = 20;
    const kpiGap = 4;
    const kpiW = (usableW - kpiGap * 5) / 6; // ~42.1mm

    const passRate = data.kpis.totalChecks > 0
        ? Math.round((data.kpis.okChecks / data.kpis.totalChecks) * 100)
        : 100;

    const cards = [
        {
            title: "MONITORED DEVICES",
            value: String(data.kpis.totalDevices),
            sub: "Total Inventory",
            accent: COLORS.primary,
            valColor: COLORS.textDark,
        },
        {
            title: "TOTAL AUDIT CHECKS",
            value: String(data.kpis.totalChecks),
            sub: `${data.dates.length} Days Recorded`,
            accent: COLORS.textMuted,
            valColor: COLORS.textDark,
        },
        {
            title: "OK CHECKS",
            value: String(data.kpis.okChecks),
            sub: `${passRate}% Pass Rate`,
            accent: COLORS.emerald,
            valColor: COLORS.emerald,
        },
        {
            title: "NOT OK CHECKS",
            value: String(data.kpis.notOkChecks),
            sub: data.kpis.notOkChecks > 0 ? "Issues Found" : "Zero Issues",
            accent: data.kpis.notOkChecks > 0 ? COLORS.rose : COLORS.textMuted,
            valColor: data.kpis.notOkChecks > 0 ? COLORS.rose : COLORS.textDark,
        },
        {
            title: "INSPECTION COVERAGE",
            value: `${data.kpis.coveragePct}%`,
            sub: "Devices Inspected",
            accent: COLORS.cyan,
            valColor: COLORS.primary,
        },
        {
            title: "DEVICES W/ ISSUE",
            value: String(data.kpis.devicesWithIssue),
            sub: data.kpis.devicesWithIssue > 0 ? "Attention Required" : "All Normal",
            accent: data.kpis.devicesWithIssue > 0 ? COLORS.amber : COLORS.emerald,
            valColor: data.kpis.devicesWithIssue > 0 ? COLORS.amber : COLORS.emerald,
        },
    ];

    cards.forEach((card, i) => {
        const x = margin + i * (kpiW + kpiGap);
        // Card Box
        doc.setFillColor(...COLORS.cardBg);
        doc.setDrawColor(...COLORS.cardBorder);
        doc.setLineWidth(0.3);
        doc.roundedRect(x, kpiY, kpiW, kpiH, 1.8, 1.8, "FD");

        // Top accent line
        doc.setFillColor(...card.accent);
        doc.roundedRect(x, kpiY, kpiW, 1.4, 0.7, 0.7, "F");

        // Card Title
        doc.setFont("helvetica", "bold");
        doc.setFontSize(5.8);
        doc.setTextColor(...COLORS.textMuted);
        doc.text(card.title, x + 3.5, kpiY + 6);

        // Card Value
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14.5);
        doc.setTextColor(...card.valColor);
        doc.text(card.value, x + 3.5, kpiY + 13.5);

        // Card Subtext
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.2);
        doc.setTextColor(...COLORS.textMuted);
        doc.text(card.sub, x + 3.5, kpiY + 17.8);
    });

    // Compute Daily Aggregates
    const perDay = data.dates.map((date) => {
        let ok = 0;
        let notOk = 0;
        let noCheck = 0;
        for (const device of data.gridData) {
            const checks = device.statusHistory[date] || [];
            if (checks.length === 0) noCheck++;
            else if (checks.some((c) => c.status === "NOT OK")) notOk++;
            else ok++;
        }
        return { date, ok, notOk, noCheck, checked: ok + notOk };
    });
    const maxChecked = Math.max(1, ...perDay.map((d) => d.checked));

    // ==========================================
    // 3. BALANCED 2-COLUMN SECTION
    // Left: Daily Compliance Trend Chart (148mm)
    // Right: Daily Summary Table (121mm)
    // ==========================================
    const colY = kpiY + kpiH + 5; // 52mm
    const leftColW = 148;
    const rightColW = usableW - leftColW - 4; // 121mm
    const colH = 68; // Height for the middle section

    // --- LEFT CONTAINER: CHART ---
    doc.setFillColor(...COLORS.cardBg);
    doc.setDrawColor(...COLORS.cardBorder);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, colY, leftColW, colH, 2, 2, "FD");

    // Section Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.textDark);
    doc.text("DAILY AUDIT COMPLIANCE & ACTIVITY TREND", margin + 5, colY + 6);

    // Chart Area
    const chartLeft = margin + 14;
    const chartW = leftColW - 20; // 128mm
    const chartTop = colY + 12;
    const chartH = 43;
    const chartBottom = chartTop + chartH;

    // Y Axis Ticks
    const step = maxChecked <= 5 ? 1 : maxChecked <= 15 ? 3 : maxChecked <= 30 ? 5 : 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.8);
    doc.setTextColor(...COLORS.textMuted);

    for (let v = 0; v <= maxChecked; v += step) {
        const y = chartBottom - (v / maxChecked) * chartH;
        if (v > 0) {
            doc.setDrawColor(...COLORS.gridLine);
            doc.setLineWidth(0.15);
            doc.line(chartLeft, y, chartLeft + chartW, y);
        }
        doc.text(String(v), chartLeft - 2, y + 1, { align: "right" });
    }

    // Baseline
    doc.setDrawColor(...COLORS.cardBorder);
    doc.setLineWidth(0.3);
    doc.line(chartLeft, chartBottom, chartLeft + chartW, chartBottom);

    // Bars
    const slotW = chartW / data.dates.length;
    const barW = Math.min(9, Math.max(3, slotW * 0.55));
    const labelEvery = data.dates.length > 21 ? 3 : data.dates.length > 12 ? 2 : 1;

    perDay.forEach((day, i) => {
        const x = chartLeft + slotW * i + (slotW - barW) / 2;
        const okH = (day.ok / maxChecked) * chartH;
        const notOkH = (day.notOk / maxChecked) * chartH;

        if (day.ok > 0) {
            doc.setFillColor(...COLORS.emerald);
            doc.rect(x, chartBottom - okH, barW, okH, "F");
        }
        if (day.notOk > 0) {
            doc.setFillColor(...COLORS.rose);
            doc.rect(x, chartBottom - okH - notOkH, barW, notOkH, "F");

            // Count badge above bar for issue days
            doc.setFont("helvetica", "bold");
            doc.setFontSize(6);
            doc.setTextColor(...COLORS.rose);
            doc.text(`${day.notOk}`, x + barW / 2, chartBottom - okH - notOkH - 1.2, { align: "center" });
        }

        // Date label below axis
        if (i % labelEvery === 0 || i === data.dates.length - 1) {
            const [, m, d] = day.date.split("-");
            doc.setFont("helvetica", "normal");
            doc.setFontSize(5.8);
            doc.setTextColor(...COLORS.textMuted);
            doc.text(`${d}/${m}`, x + barW / 2, chartBottom + 4.2, { align: "center" });
        }
    });

    // Chart Legend (Bottom left of chart container)
    const legendY = colY + colH - 4;
    let legX = margin + 6;

    // OK Legend
    doc.setFillColor(...COLORS.emerald);
    doc.roundedRect(legX, legendY - 2.5, 3, 3, 0.5, 0.5, "F");
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.textDark);
    doc.text("Passed (OK)", legX + 4.5, legendY);
    legX += doc.getTextWidth("Passed (OK)") + 10;

    // NOT OK Legend
    doc.setFillColor(...COLORS.rose);
    doc.roundedRect(legX, legendY - 2.5, 3, 3, 0.5, 0.5, "F");
    doc.text("Failed (NOT OK)", legX + 4.5, legendY);

    // --- RIGHT CONTAINER: SUMMARY TABLE ---
    const rightX = margin + leftColW + 4;
    doc.setFillColor(...COLORS.cardBg);
    doc.setDrawColor(...COLORS.cardBorder);
    doc.setLineWidth(0.3);
    doc.roundedRect(rightX, colY, rightColW, colH, 2, 2, "FD");

    // Section Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.textDark);
    doc.text("DAILY AUDIT EXECUTION BREAKDOWN", rightX + 5, colY + 6);

    // AutoTable for Daily Breakdown
    autoTable(doc, {
        startY: colY + 9,
        margin: { left: rightX + 3, right: pageWidth - (rightX + rightColW - 3) },
        head: [["Date", "OK", "Issue", "No Check", "Coverage"]],
        body: perDay.map((d) => [
            d.date,
            String(d.ok),
            String(d.notOk),
            String(d.noCheck),
            `${Math.round(((d.ok + d.notOk) / Math.max(1, data.gridData.length)) * 100)}%`,
        ]),
        theme: "plain",
        styles: {
            fontSize: 6.2,
            cellPadding: { top: 1.2, bottom: 1.2, left: 1.5, right: 1.5 },
            textColor: COLORS.textDark,
            lineColor: COLORS.cardBorder,
            lineWidth: { bottom: 0.15 },
        },
        headStyles: {
            fontSize: 6.2,
            textColor: [255, 255, 255],
            fillColor: [30, 41, 59], // Slate 800
            fontStyle: "bold",
            halign: "center",
            cellPadding: { top: 1.6, bottom: 1.6, left: 1.5, right: 1.5 },
        },
        columnStyles: {
            0: { cellWidth: 26, fontStyle: "bold", halign: "left" },
            1: { cellWidth: 20, halign: "center" },
            2: { cellWidth: 20, halign: "center" },
            3: { cellWidth: 24, halign: "center", textColor: COLORS.textMuted },
            4: { cellWidth: 25, halign: "center", fontStyle: "bold" },
        },
        didParseCell: (hookData) => {
            if (hookData.section === "body" && hookData.column.index === 2 && Number(hookData.cell.raw) > 0) {
                hookData.cell.styles.fillColor = COLORS.roseBg;
                hookData.cell.styles.textColor = COLORS.rose;
                hookData.cell.styles.fontStyle = "bold";
            }
        },
    });

    // ==========================================
    // 4. BOTTOM SECTION (Height ~56mm)
    // Left: Category Health Breakdown (148mm)
    // Right: Room Environmental Temperatures (121mm)
    // ==========================================
    const botY = colY + colH + 4; // 124mm
    const botH = pageHeight - botY - margin; // ~74mm

    // --- BOTTOM LEFT: CATEGORY HEALTH ---
    doc.setFillColor(...COLORS.cardBg);
    doc.setDrawColor(...COLORS.cardBorder);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, botY, leftColW, botH, 2, 2, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.textDark);
    doc.text("EQUIPMENT CATEGORY HEALTH STATUS", margin + 5, botY + 6);

    // Render Categories as Cards / Compact Grid
    const catCardW = (leftColW - 14) / 3; // 3 columns of category pills
    const catCardH = 13.5;
    const catStartX = margin + 4;
    const catStartY = botY + 9;

    data.categories.slice(0, 12).forEach((cat, idx) => {
        const cCol = idx % 3;
        const cRow = Math.floor(idx / 3);
        const cx = catStartX + cCol * (catCardW + 3);
        const cy = catStartY + cRow * (catCardH + 2.5);

        if (cy + catCardH > botY + botH - 2) return; // Prevent overflow

        const hasIssue = cat.notOk > 0;
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(...(hasIssue ? COLORS.rose : COLORS.cardBorder));
        doc.setLineWidth(hasIssue ? 0.35 : 0.2);
        doc.roundedRect(cx, cy, catCardW, catCardH, 1.2, 1.2, "FD");

        // Category Name
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.2);
        doc.setTextColor(...COLORS.textDark);
        doc.text(cat.category, cx + 2.5, cy + 4.5);

        // Stats
        doc.setFont("helvetica", "normal");
        doc.setFontSize(5.6);
        doc.setTextColor(...COLORS.textMuted);
        doc.text(`${cat.total} checks`, cx + 2.5, cy + 8.5);

        // Status Badge
        doc.setFont("helvetica", "bold");
        if (hasIssue) {
            doc.setTextColor(...COLORS.rose);
            doc.text(`⚠ ${cat.notOk} NOT OK`, cx + 2.5, cy + 11.8);
        } else {
            doc.setTextColor(...COLORS.emerald);
            doc.text("✓ 100% OK", cx + 2.5, cy + 11.8);
        }
    });

    // --- BOTTOM RIGHT: ROOM TEMPERATURES ---
    doc.setFillColor(...COLORS.cardBg);
    doc.setDrawColor(...COLORS.cardBorder);
    doc.setLineWidth(0.3);
    doc.roundedRect(rightX, botY, rightColW, botH, 2, 2, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.textDark);
    doc.text("DATA CENTER ROOM TEMPERATURES (°C)", rightX + 5, botY + 6);

    const roomDatesWithTemp = (data.roomTempByDate ? Object.keys(data.roomTempByDate) : [])
        .filter((d) => (data.roomTempByDate?.[d] ?? []).length > 0)
        .slice(-6); // Show up to last 6 entries

    if (roomDatesWithTemp.length === 0) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(...COLORS.textMuted);
        doc.text("No room temperature telemetry recorded in this audit period.", rightX + 5, botY + 16);
    } else {
        autoTable(doc, {
            startY: botY + 9,
            margin: { left: rightX + 3, right: pageWidth - (rightX + rightColW - 3) },
            head: [["Date", "Location Readings"]],
            body: roomDatesWithTemp.map((d) => [
                d,
                (data.roomTempByDate?.[d] ?? []).join("   ·   "),
            ]),
            theme: "plain",
            styles: {
                fontSize: 6.2,
                cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 },
                textColor: COLORS.textDark,
                lineColor: COLORS.cardBorder,
                lineWidth: { bottom: 0.15 },
            },
            headStyles: {
                fontSize: 6.2,
                textColor: [255, 255, 255],
                fillColor: [30, 41, 59],
                fontStyle: "bold",
            },
            columnStyles: {
                0: { cellWidth: 26, fontStyle: "bold" },
                1: { cellWidth: rightColW - 34 },
            },
        });
    }

    // ==========================================
    // 5. PAGE 2+: FULL DEVICE × DATE AUDIT MATRIX
    // ==========================================
    doc.addPage("a4", "landscape");

    // Header on Page 2
    doc.setFillColor(...COLORS.headerBg);
    doc.rect(0, 0, pageWidth, 16, "F");
    doc.setFillColor(...COLORS.primary);
    doc.rect(0, 15, pageWidth, 1, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(255, 255, 255);
    doc.text("DEVICE AUDIT MATRIX & AUDITOR LOG", margin, 9);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.headerSub);
    doc.text(`Period ${periodStart} — ${periodEnd}  ·  ${data.gridData.length} Devices Monitored`, margin, 13.5);

    // Build Table Header & Body
    const matrixHead = [["Device", "Category", ...data.dates.map((d) => {
        const dt = new Date(d + "T00:00:00");
        const weekday = dt.toLocaleDateString("en-US", { weekday: "short" });
        return `${weekday} ${dt.getDate()}/${dt.getMonth() + 1}`;
    })]];

    const matrixBody = data.gridData.map((device) => [
        device.name,
        device.categoryName || "-",
        ...data.dates.map((d) => {
            const checks = device.statusHistory[d] || [];
            if (checks.length === 0) return "-";
            const last = checks[checks.length - 1];
            const checkerName = last.checker || last.username || "Auditor";
            return `${last.status}\n${checkerName.slice(0, 10)}`;
        }),
    ]);

    autoTable(doc, {
        startY: 19,
        margin: { left: margin, right: margin },
        head: matrixHead,
        body: matrixBody,
        theme: "grid",
        styles: {
            fontSize: 5.5,
            cellPadding: 1,
            valign: "middle",
            halign: "center",
            textColor: COLORS.textDark,
            lineColor: COLORS.cardBorder,
            lineWidth: 0.12,
        },
        headStyles: {
            fillColor: [30, 41, 59],
            textColor: [255, 255, 255],
            fontStyle: "bold",
            fontSize: 5.8,
            halign: "center",
        },
        columnStyles: {
            0: { halign: "left", fontStyle: "bold", cellWidth: 32 },
            1: { halign: "left", cellWidth: 22, textColor: COLORS.textMuted },
        },
        didParseCell: (hookData) => {
            if (hookData.section === "body" && hookData.column.index >= 2) {
                const text = String(hookData.cell.raw ?? "");
                if (text.includes("NOT OK")) {
                    hookData.cell.styles.fillColor = COLORS.roseBg;
                    hookData.cell.styles.textColor = COLORS.rose;
                    hookData.cell.styles.fontStyle = "bold";
                } else if (text.includes("OK")) {
                    hookData.cell.styles.fillColor = COLORS.emeraldBg;
                    hookData.cell.styles.textColor = [6, 95, 70]; // emerald 800
                } else {
                    hookData.cell.styles.textColor = COLORS.textMuted;
                }
            }
        },
    });

    return doc;
}

/**
 * Returns the generated PDF as a Node.js Buffer for email attachments.
 */
export function getAuditGridPdfBuffer(
    data: RawGridExportData,
    options?: { statusFilter?: string; siteName?: string }
): Buffer {
    const doc = buildAuditGridPdf(data, options);
    const arrayBuffer = doc.output("arraybuffer");
    return Buffer.from(arrayBuffer);
}
