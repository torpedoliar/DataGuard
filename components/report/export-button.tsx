
"use client";

import { getRawExportData, exportToExcel } from "@/actions/report";
import { Download, Loader2, FileText } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export default function ExportButton() {
    const searchParams = useSearchParams();
    const [isExportingExcel, setIsExportingExcel] = useState(false);
    const [isExportingPDF, setIsExportingPDF] = useState(false);

    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    const startDate = searchParams.get("startDate") || formatDate(firstDay);
    const endDate = searchParams.get("endDate") || formatDate(today);

    const handleExcelExport = async () => {
        setIsExportingExcel(true);
        try {
            const base64 = await exportToExcel(startDate, endDate);

            // Convert base64 to blob
            const byteCharacters = atob(base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

            // Download
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `DC_Checklist_${startDate}_to_${endDate}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

        } catch (error) {
            console.error("Export failed", error);
            alert("Failed to export report");
        } finally {
            setIsExportingExcel(false);
        }
    };

    const handlePDFExport = async () => {
        setIsExportingPDF(true);
        try {
            const data = await getRawExportData(startDate, endDate);
            if (!data || data.length === 0) {
                alert("No data available to export for this date range.");
                return;
            }

            const doc = new jsPDF("landscape");

            // Document Title
            doc.setFontSize(18);
            doc.text("Data Center Device Checklist Report", 14, 22);
            doc.setFontSize(11);
            doc.setTextColor(100);
            doc.text(`Period: ${startDate} to ${endDate}`, 14, 30);

            // Table Body Mapping
            const tableData = data.map((item) => [
                item.date,
                item.time,
                item.shift,
                item.device,
                item.location,
                item.category,
                item.status,
                item.checker,
                item.remarks || "-"
            ]);

            autoTable(doc, {
                startY: 36,
                head: [["Date", "Time", "Shift", "Device Name", "Location", "Category", "Status", "Checker", "Remarks"]],
                body: tableData,
                theme: "striped",
                headStyles: { fillColor: [41, 128, 185] },
                styles: { fontSize: 8 },
                columnStyles: {
                    8: { cellWidth: 40 } // Give remarks column more space
                }
            });

            doc.save(`DC_Checklist_${startDate}_to_${endDate}.pdf`);

        } catch (error) {
            console.error("PDF Export failed", error);
            alert("Failed to export PDF report");
        } finally {
            setIsExportingPDF(false);
        }
    };

    return (
        <div className="flex items-center gap-2">
            <button
                onClick={handleExcelExport}
                disabled={isExportingExcel || isExportingPDF}
                className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
                {isExportingExcel ? <Loader2 className="animate-spin h-4 w-4" /> : <Download className="h-4 w-4" />}
                Export Excel
            </button>
            <button
                onClick={handlePDFExport}
                disabled={isExportingPDF || isExportingExcel}
                className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
                title="Download as PDF Report"
            >
                {isExportingPDF ? <Loader2 className="animate-spin h-4 w-4" /> : <FileText className="h-4 w-4" />}
                Export PDF
            </button>
        </div>
    );
}
