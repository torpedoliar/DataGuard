"use client";

import ActionButton from "@/components/ui/action-button";
import { exportGridToExcel, getRawGridExportData } from "@/actions/grid";
import { buildAuditGridPdf, type RawGridExportData } from "@/lib/grid-pdf";
import { Download, FileText } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

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

            const doc = buildAuditGridPdf(data as RawGridExportData, {
                statusFilter,
            });

            doc.save(`DC_Audit_Grid_${data.dates[0]}_to_${data.dates[data.dates.length - 1]}.pdf`);
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
                title="Download an executive printable colored PDF report"
            >
                PDF
            </ActionButton>
        </div>
    );
}
