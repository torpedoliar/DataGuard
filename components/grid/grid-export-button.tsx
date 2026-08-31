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
// Excel = styled spreadsheet (xlsx-js-style). PDF = printable colored report
// with KPI summary + category breakdown (jsPDF, already a dependency).
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

            const doc = new jsPDF({ orientation: "landscape" });
            const pageWidth = doc.internal.pageSize.getWidth();

            // ---- Title block ----
            doc.setFontSize(18);
            doc.setTextColor(15, 23, 42);
            doc.text("Data Center Audit Grid Report", 14, 20);
            doc.setFontSize(10);
            doc.setTextColor(100);
            doc.text(`Period: ${data.dates[0]} to ${data.dates[data.dates.length - 1]}  ·  Status filter: ${statusFilter && statusFilter !== "All" ? statusFilter : "All"}`, 14, 27);

            // ---- KPI cards (simple filled boxes) ----
            const kpis = [
                { label: "Devices", value: String(data.kpis.totalDevices), color: [41, 128, 185] as const },
                { label: "Total Checks", value: String(data.kpis.totalChecks), color: [100, 116, 139] as const },
                { label: "OK", value: String(data.kpis.okChecks), color: [22, 163, 74] as const },
                { label: "NOT OK", value: String(data.kpis.notOkChecks), color: [220, 38, 38] as const },
                { label: "Coverage", value: `${data.kpis.coveragePct}%`, color: [5, 150, 105] as const },
                { label: "Devices w/ Issue", value: String(data.kpis.devicesWithIssue), color: [217, 119, 6] as const },
            ];
            const cardWidth = 42;
            const cardHeight = 18;
            const gap = 5;
            let cardX = 14;
            const cardY = 33;
            for (const kpi of kpis) {
                doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2]);
                doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 2, 2, "F");
                doc.setFontSize(14);
                doc.setTextColor(255);
                doc.text(kpi.value, cardX + 4, cardY + 8);
                doc.setFontSize(7);
                doc.setTextColor(230);
                doc.text(kpi.label.toUpperCase(), cardX + 4, cardY + 14);
                cardX += cardWidth + gap;
            }

            // ---- Category breakdown ----
            doc.setFontSize(9);
            doc.setTextColor(60);
            const categoryText = data.categories
                .map((c) => `${c.category}: ${c.total} checks, ${c.notOk} NOT OK`)
                .join("   ·   ");
            doc.text(doc.splitTextToSize(categoryText, pageWidth - 28), 14, 60);

            // ---- Per-date summary table (the generated period, day by day) ----
            const summaryRows = data.dates.map((date) => {
                let ok = 0;
                let notOk = 0;
                let noCheck = 0;
                for (const device of data.gridData) {
                    const checks = device.statusHistory[date] || [];
                    if (checks.length === 0) noCheck++;
                    else if (checks.some((c) => c.status === "NOT OK")) notOk++;
                    else ok++;
                }
                const dt = new Date(date + "T00:00:00");
                return [
                    `${dt.toLocaleDateString("en-US", { weekday: "short" })} ${date}`,
                    String(ok),
                    String(notOk),
                    String(noCheck),
                    data.gridData.length ? `${Math.round(((ok + notOk) / data.gridData.length) * 100)}%` : "0%",
                ];
            });
            autoTable(doc, {
                startY: 66,
                head: [["Date", "OK", "NOT OK", "No Check", "Checked"]],
                body: summaryRows,
                theme: "striped",
                styles: { fontSize: 7.5, cellPadding: 1.5 },
                headStyles: { fillColor: [41, 128, 185], textColor: 255, fontSize: 7.5 },
                columnStyles: {
                    0: { cellWidth: 70, fontStyle: "bold" },
                    1: { halign: "center", textColor: [21, 128, 61] },
                    2: { halign: "center", textColor: [153, 27, 27] },
                    3: { halign: "center", textColor: [100, 116, 139] },
                    4: { halign: "center", fontStyle: "bold" },
                },
                didParseCell: (hookData) => {
                    if (hookData.section !== "body" || hookData.column.index !== 2) return;
                    if (Number(hookData.cell.raw) > 0) hookData.cell.styles.fillColor = [254, 226, 226];
                },
            });

            // ---- Matrix table ----
            const matrixStartY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 66;
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
                    if (checks.length === 1) return checks[0].status === "OK" ? "OK" : `NOT OK (${checks[0].username})`;
                    return checks.map((c) => `${c.status} (${c.username})`).join("\n");
                }),
            ]);

            autoTable(doc, {
                startY: matrixStartY + 8,
                head,
                body,
                theme: "grid",
                styles: { fontSize: 6.5, cellPadding: 1.5, lineColor: [226, 232, 240], lineWidth: 0.2, valign: "middle" },
                headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 6, halign: "center" },
                columnStyles: {
                    0: { cellWidth: 42, fontStyle: "bold" },
                    1: { cellWidth: 24, textColor: [100, 116, 139] },
                },
                // Color the status cells like the on-screen grid.
                didParseCell: (hookData) => {
                    if (hookData.section !== "body" || hookData.column.index < 2) return;
                    const raw = String(hookData.cell.raw ?? "");
                    if (!raw) {
                        hookData.cell.styles.fillColor = [248, 250, 252];
                        return;
                    }
                    if (raw.includes("NOT OK")) {
                        hookData.cell.styles.fillColor = [254, 226, 226];
                        hookData.cell.styles.textColor = [153, 27, 27];
                    } else if (raw.includes("OK")) {
                        hookData.cell.styles.fillColor = [220, 252, 231];
                        hookData.cell.styles.textColor = [21, 128, 61];
                    }
                },
                didDrawPage: () => {
                    // Highlight today's column header when it lands on a page.
                    doc.setFontSize(7);
                    doc.setTextColor(150);
                    doc.text(
                        `Generated ${new Date().toLocaleString("en-GB")} · DataGuard`,
                        pageWidth - 14,
                        doc.internal.pageSize.getHeight() - 6,
                        { align: "right" },
                    );
                },
            });

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
