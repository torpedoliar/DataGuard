"use client";

import ActionButton from "@/components/ui/action-button";
import { exportGridToExcel, getRawGridExportData, type DailyCheck } from "@/actions/grid";
import { Download, FileText } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Export the on-screen Audit Grid (Device × Date matrix) for the
// currently-applied date range and status filter. Reads the same
// searchParams the grid page uses, so exports always match what's shown.
//
// PDF design follows the dataviz method: status colors (good/critical) only
// ever color marks — every value and label stays in ink tokens; marks are
// thin with 2px surface gaps; gridlines are recessive hairlines; labels are
// selective. Colors are the validated reference status palette
// (good #0ca30c · critical #d03b3b; neutral gray for absence), mitigated by
// text labels in every cell (status never rides on color alone).
const INK = { primary: [11, 11, 11] as [number, number, number], secondary: [82, 81, 78] as [number, number, number], muted: [137, 135, 129] as [number, number, number] };
const GRID: [number, number, number] = [225, 224, 217]; // hairline #e1e0d9
const TILE: [number, number, number] = [252, 252, 251]; // chart surface #fcfcfb
const STATUS = {
    good: [12, 163, 12] as [number, number, number],           // #0ca30c
    goodWash: [220, 252, 231] as [number, number, number],     // emerald-50
    critical: [208, 59, 59] as [number, number, number],       // #d03b3b
    criticalWash: [254, 226, 226] as [number, number, number], // red-50
    warning: [250, 178, 25] as [number, number, number],       // #fab219
    absence: [195, 194, 183] as [number, number, number],      // baseline gray — "nothing"
};

export default function GridExportButton() {
    const searchParams = useSearchParams();
    const [isExportingExcel, setIsExportingExcel] = useState(false);
    const [isExportingPDF, setIsExportingPDF] = useState(false);

    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;
    const statusFilter = searchParams.get("status") || undefined;

    const downloadBlob = (data: BlobPart, filename: string, mime: string) => {
        const blob = new Blob([data], { type: mime });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    };

    const handleExcelExport = async () => {
        setIsExportingExcel(true);
        try {
            const base64 = await exportGridToExcel(startDate, endDate, statusFilter);
            const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
            downloadBlob(bytes, `DC_Grid_${startDate ?? "all"}_to_${endDate ?? "today"}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        } catch (error) {
            console.error("Grid export failed", error);
            alert("Failed to export grid report");
        } finally {
            setIsExportingExcel(false);
        }
    };

    const handlePdfExport = async () => {
        setIsExportingPDF(true);
        try {
            const data = await getRawGridExportData(startDate, endDate, statusFilter);
            if (!data || data.gridData.length === 0) {
                alert("No data available to export for this date range.");
                return;
            }

            const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const left = 14;
            const usable = pageWidth - left * 2;

            // ---- Title block ----
            doc.setFont("helvetica", "bold");
            doc.setFontSize(17);
            doc.setTextColor(...INK.primary);
            doc.text("Data Center Audit Grid Report", left, 16);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
            doc.setTextColor(...INK.secondary);
            doc.text(
                `Period ${data.dates[0]} — ${data.dates[data.dates.length - 1]}   ·   Status filter: ${statusFilter && statusFilter !== "All" ? statusFilter : "All"}   ·   ${data.gridData.length} devices`,
                left, 22,
            );
            // Hairline under the title block.
            doc.setDrawColor(...GRID);
            doc.setLineWidth(0.2);
            doc.line(left, 25.5, pageWidth - left, 25.5);

            // ---- KPI stat tiles (label + value in ink; a small status dot
            // beside the label carries identity — text never wears data color) ----
            const tiles = [
                { label: "Devices", value: String(data.kpis.totalDevices) },
                { label: "Total checks", value: String(data.kpis.totalChecks) },
                { label: "OK checks", value: String(data.kpis.okChecks), dot: STATUS.good },
                { label: "NOT OK checks", value: String(data.kpis.notOkChecks), dot: STATUS.critical },
                { label: "Coverage", value: `${data.kpis.coveragePct}%` },
                { label: "Devices w/ issue", value: String(data.kpis.devicesWithIssue), dot: STATUS.warning },
            ];
            const tileW = (usable - 5 * 4) / 6; // 4mm gaps
            const tileH = 17;
            const tileY = 29;
            tiles.forEach((tile, i) => {
                const x = left + i * (tileW + 4);
                doc.setFillColor(...TILE);
                doc.setDrawColor(...GRID);
                doc.setLineWidth(0.2);
                doc.roundedRect(x, tileY, tileW, tileH, 1.5, 1.5, "FD");
                doc.setFontSize(5.8);
                doc.setTextColor(...INK.muted);
                doc.text(tile.label.toUpperCase(), x + 3.5, tileY + 6);
                if (tile.dot) {
                    doc.setFillColor(...tile.dot);
                    doc.circle(x + tileW - 5, tileY + 4.4, 1.1, "F");
                }
                doc.setFont("helvetica", "bold");
                doc.setFontSize(15);
                doc.setTextColor(...INK.primary);
                doc.text(tile.value, x + 3.5, tileY + 13);
                doc.setFont("helvetica", "normal");
            });

            // ---- Per-day counts (shared by chart + summary table) ----
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
                return { date, ok, notOk, noCheck };
            });
            const maxChecked = Math.max(1, ...perDay.map((d) => d.ok + d.notOk));

            // ---- Daily compliance chart: bar height = devices checked that
            // day; green portion OK, red portion NOT OK; unfilled remainder is
            // the not-yet-checked share (the summary table lists it exactly). ----
            const chartTop = 52;
            const chartHeight = 38;
            const chartBottom = chartTop + chartHeight;
            const dayLabelY = chartBottom + 5;
            const labelEvery = data.dates.length > 21 ? 3 : data.dates.length > 12 ? 2 : 1;

            // Clean y ticks: 0..maxChecked in 1/2/5 steps.
            const rawStep = maxChecked / 4;
            const step = rawStep <= 1 ? 1 : rawStep <= 2 ? 2 : rawStep <= 5 ? 5 : Math.ceil(rawStep / 5) * 5;
            doc.setFontSize(6.5);
            doc.setTextColor(...INK.muted);
            for (let v = 0; v <= maxChecked; v += step) {
                const y = chartBottom - (v / maxChecked) * chartHeight;
                if (v > 0) {
                    doc.setDrawColor(...GRID);
                    doc.setLineWidth(0.15);
                    doc.line(left + 8, y, pageWidth - left, y); // recessive hairline
                }
                doc.text(String(v), left + 6.5, y + 1, { align: "right" });
            }
            // Baseline.
            doc.setDrawColor(...INK.secondary);
            doc.setLineWidth(0.3);
            doc.line(left + 8, chartBottom, pageWidth - left, chartBottom);

            // Bars: thin (never fill the slot), 2px surface gaps between segments.
            const chartLeft = left + 8;
            const chartWidth = pageWidth - left - chartLeft;
            const slot = chartWidth / data.dates.length;
            const barW = Math.min(8, slot * 0.6);
            const gap = 0.6; // ≈2px surface gap
            perDay.forEach((day, i) => {
                const checked = day.ok + day.notOk;
                if (checked === 0) return; // no bar: absence reads as the surface
                const x = chartLeft + slot * i + (slot - barW) / 2;
                const okH = (day.ok / maxChecked) * chartHeight;
                const notOkH = (day.notOk / maxChecked) * chartHeight;
                if (day.ok > 0) {
                    doc.setFillColor(...STATUS.good);
                    doc.rect(x, chartBottom - okH, barW, okH, "F");
                }
                if (day.notOk > 0) {
                    doc.setFillColor(...STATUS.critical);
                    doc.rect(x, chartBottom - okH - notOkH - gap, barW, notOkH, "F");
                }
                // Selective direct label: only problem days get a count above
                // the bar (the story), in ink.
                if (day.notOk > 0) {
                    doc.setFont("helvetica", "bold");
                    doc.setFontSize(6.5);
                    doc.setTextColor(...INK.primary);
                    doc.text(String(day.notOk), x + barW / 2, chartBottom - okH - notOkH - gap - 1.5, { align: "center" });
                    doc.setFont("helvetica", "normal");
                }
            });

            // Day labels (thinned when crowded), muted.
            doc.setFontSize(6.5);
            doc.setTextColor(...INK.muted);
            data.dates.forEach((date, i) => {
                if (i % labelEvery !== 0 && i !== data.dates.length - 1) return;
                const [, m, d] = date.split("-");
                doc.text(`${d}/${m}`, chartLeft + slot * i + slot / 2, dayLabelY, { align: "center" });
            });

            // Legend (always present: 2 series) — swatch + ink label.
            const legendY = chartTop - 4;
            let legendX = chartLeft;
            const legendItems = [
                { label: "OK", color: STATUS.good },
                { label: "NOT OK", color: STATUS.critical },
            ];
            doc.setFontSize(7);
            for (const item of legendItems) {
                doc.setFillColor(...item.color);
                doc.rect(legendX, legendY - 2.4, 2.6, 2.6, "F");
                doc.setTextColor(...INK.secondary);
                doc.text(item.label, legendX + 3.8, legendY - 0.4);
                legendX += 3.8 + doc.getTextWidth(item.label) + 6;
            }

            // ---- Summary table (the exact per-day numbers behind the chart) ----
            autoTable(doc, {
                startY: dayLabelY + 3,
                margin: { left, right: left },
                head: [["Date", "OK", "NOT OK", "No check", "Checked"]],
                body: perDay.map((day) => [
                    day.date,
                    String(day.ok),
                    String(day.notOk),
                    String(day.noCheck),
                    `${Math.round(((day.ok + day.notOk) / data.gridData.length) * 100)}%`,
                ]),
                theme: "plain",
                styles: { fontSize: 7, cellPadding: { top: 1.1, bottom: 1.1, left: 2, right: 2 }, textColor: INK.primary, lineColor: GRID, lineWidth: { bottom: 0.15 } },
                headStyles: { fontSize: 6.5, textColor: INK.muted, fontStyle: "bold", lineWidth: { bottom: 0.3 }, cellPadding: { top: 1.2, bottom: 1.2, left: 2, right: 2 } },
                columnStyles: {
                    0: { cellWidth: 34, fontStyle: "bold" },
                    1: { halign: "center", cellWidth: 20 },
                    2: { halign: "center", cellWidth: 22 },
                    3: { halign: "center", cellWidth: 22, textColor: INK.secondary },
                    4: { halign: "center", cellWidth: 20, fontStyle: "bold" },
                },
                didParseCell: (hookData) => {
                    // Status wash under the NOT OK count; text stays ink.
                    if (hookData.section === "body" && hookData.column.index === 2 && Number(hookData.cell.raw) > 0) {
                        hookData.cell.styles.fillColor = STATUS.criticalWash;
                        hookData.cell.styles.textColor = INK.primary;
                    }
                },
                // Compact layout: summary rows share the page width in two columns.
                didDrawPage: () => { /* page hook reserved */ },
            });

            // ---- Category breakdown (one quiet line) ----
            const summaryEndY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100;
            doc.setFontSize(7.5);
            doc.setTextColor(...INK.secondary);
            const categoryText = `By category — ${data.categories.map((c) => `${c.category}: ${c.total} checks, ${c.notOk} NOT OK`).join("   ·   ")}`;
            doc.text(doc.splitTextToSize(categoryText, usable), left, summaryEndY + 5);

            // ---- Device × Date matrix (colored status cells; auditor shown
            // for every check, OK included) ----
            const head = [["Device", "Category", ...data.dates.map((d) => {
                const dt = new Date(d + "T00:00:00");
                return `${dt.toLocaleDateString("en-US", { weekday: "short" })} ${dt.getDate()}/${dt.getMonth() + 1}`;
            })]];
            const body = data.gridData.map((device) => [
                device.name + (device.locationName ? `\n${device.locationName}` : ""),
                device.categoryName || "-",
                ...data.dates.map((date) => {
                    const checks: DailyCheck[] = device.statusHistory[date] || [];
                    if (checks.length === 0) return "";
                    return checks
                        .map((c) => `${c.status} (${c.username} ${c.time})`)
                        .join("\n");
                }),
            ]);

            autoTable(doc, {
                startY: summaryEndY + 9,
                margin: { left, right: left },
                head,
                body,
                theme: "grid",
                styles: { fontSize: 6, cellPadding: 1.2, lineColor: GRID, lineWidth: 0.15, valign: "middle", textColor: INK.primary },
                headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontSize: 5.8, halign: "center" },
                // Date columns shrink to fit the page; the matrix can span
                // multiple pages horizontally for long periods (autoTable
                // splits it — the first two columns repeat via horizontal
                // page break, which autoTable handles natively).
                columnStyles: {
                    0: { cellWidth: 38, fontStyle: "bold" },
                    1: { cellWidth: 20, textColor: INK.secondary },
                },
                horizontalPageBreak: true,
                didParseCell: (hookData) => {
                    if (hookData.section !== "body" || hookData.column.index < 2) return;
                    const raw = String(hookData.cell.raw ?? "");
                    if (!raw) {
                        hookData.cell.styles.fillColor = [248, 250, 252];
                        hookData.cell.styles.textColor = INK.muted;
                        return;
                    }
                    // Status washes carry the state; cell text stays ink.
                    if (raw.includes("NOT OK")) {
                        hookData.cell.styles.fillColor = STATUS.criticalWash;
                    } else if (raw.includes("OK")) {
                        hookData.cell.styles.fillColor = STATUS.goodWash;
                    }
                },
            });

            // ---- Footers: page numbers + generation stamp ----
            const pageCount = doc.getNumberOfPages();
            for (let p = 1; p <= pageCount; p++) {
                doc.setPage(p);
                doc.setFontSize(6.5);
                doc.setTextColor(...INK.muted);
                doc.text(`Generated ${new Date().toLocaleString("en-GB")} · DataGuard`, pageWidth - left, pageHeight - 6, { align: "right" });
                doc.text(`Page ${p}/${pageCount}`, left, pageHeight - 6);
            }

            doc.save(`DC_Grid_${data.dates[0]}_to_${data.dates[data.dates.length - 1]}.pdf`);
        } catch (error) {
            console.error("PDF export failed", error);
            alert("Failed to export PDF grid report");
        } finally {
            setIsExportingPDF(false);
        }
    };

    return (
        <div className="flex items-center gap-2">
            <ActionButton
                type="button"
                onClick={handleExcelExport}
                disabled={isExportingExcel || isExportingPDF}
                isPending={isExportingExcel}
                icon={<Download className="size-4" />}
                variant="secondary"
                title="Download the audit grid as an Excel file"
            >
                Excel
            </ActionButton>
            <ActionButton
                type="button"
                onClick={handlePdfExport}
                disabled={isExportingPDF || isExportingExcel}
                isPending={isExportingPDF}
                icon={<FileText className="size-4" />}
                variant="danger"
                title="Download a printable colored PDF report"
            >
                PDF
            </ActionButton>
        </div>
    );
}
