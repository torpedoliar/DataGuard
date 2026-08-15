"use client";

import { useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import ActionButton from "@/components/ui/action-button";
import { FileText } from "lucide-react";
import {
    buildFaceplate,
    faceplateSlotColors,
    hexToRgb,
    isUplinkMedia,
    FACEPLATE_PALETTE,
    type FaceplateConfigInput,
} from "@/lib/faceplate";
import type { NetworkPortRow } from "./device-faceplate";

/** Caps the drawing scale so an 8 port switch does not print comically large. */
const MAX_SCALE = 0.8;

function logicalConfig(port: NetworkPortRow) {
    if (port.portMode === "Access") return port.vlanNumber ? `Access · VLAN ${port.vlanNumber}${port.vlanName ? ` (${port.vlanName})` : ""}` : "Access";
    if (port.portMode === "Trunk") return `Trunk · ${port.trunkVlans || "All"}${port.vlanNumber ? ` · native ${port.vlanNumber}` : ""}`;
    if (port.portMode === "Routed") return `Routed · ${port.ipAddress || "-"}`;
    return port.portMode || "-";
}

export default function FaceplatePdfButton({
    deviceName,
    deviceIp,
    brandName,
    locationName,
    siteName,
    config,
    ports,
}: {
    deviceName: string;
    deviceIp: string | null;
    brandName: string | null;
    locationName: string | null;
    siteName?: string | null;
    config: FaceplateConfigInput;
    ports: NetworkPortRow[];
}) {
    const [isExporting, setIsExporting] = useState(false);

    const handleExport = () => {
        setIsExporting(true);
        try {
            const faceplate = buildFaceplate<NetworkPortRow>(config, ports);
            const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
            const pageWidth = doc.internal.pageSize.getWidth();
            const margin = 14;
            const available = pageWidth - margin * 2;

            doc.setFontSize(16);
            doc.setTextColor(15, 23, 42);
            doc.text(`${deviceName} — Network Documentation`, margin, 18);

            doc.setFontSize(9);
            doc.setTextColor(100);
            const metaLine = [
                siteName ? `Site: ${siteName}` : null,
                brandName ? `Brand: ${brandName}` : null,
                locationName ? `Location: ${locationName}` : null,
                `Management IP: ${deviceIp || "-"}`,
                `Generated: ${new Date().toLocaleString("id-ID")}`,
            ].filter(Boolean).join("  •  ");
            doc.text(metaLine, margin, 24);

            let cursorY = 30;

            if (faceplate.slots.length > 0) {
                const scale = Math.min(available / faceplate.width, MAX_SCALE);
                const originX = margin;
                const originY = cursorY;
                const at = (value: number) => value * scale;

                // Chassis
                doc.setFillColor(...hexToRgb(FACEPLATE_PALETTE.chassis.fill));
                doc.setDrawColor(...hexToRgb(FACEPLATE_PALETTE.chassis.stroke));
                doc.setLineWidth(0.2);
                doc.roundedRect(originX, originY, at(faceplate.width), at(faceplate.height), 1, 1, "FD");

                // Block labels
                doc.setFontSize(Math.max(5, 12 * scale));
                doc.setTextColor(148, 163, 184);
                for (const block of faceplate.blocks) {
                    doc.text(block.label, originX + at(block.x), originY + at(block.labelY));
                }

                const slotFontSize = Math.max(4, 14 * scale);
                for (const slot of faceplate.slots) {
                    const colors = faceplateSlotColors(slot.port);
                    const x = originX + at(slot.x);
                    const y = originY + at(slot.y);
                    const width = at(slot.width);
                    const height = at(slot.height);

                    doc.setFillColor(...hexToRgb(colors.fill));
                    doc.setDrawColor(...hexToRgb(colors.stroke));
                    doc.setLineWidth(0.15);
                    if (!slot.port) doc.setLineDashPattern([0.6, 0.5], 0);
                    doc.roundedRect(x, y, width, height, 0.4, 0.4, "FD");
                    if (!slot.port) doc.setLineDashPattern([], 0);

                    // Media hint: a slit for SFP cages, a latch notch for RJ45.
                    doc.setFillColor(15, 23, 42);
                    if (slot.block === "uplink" || isUplinkMedia(slot.port?.mediaType)) {
                        doc.rect(x + at(3), y + height / 2 - at(1.5), width - at(6), at(3), "F");
                    } else {
                        doc.rect(x + width / 2 - at(3), y + height - at(4.5), at(6), at(3), "F");
                    }

                    if (colors.accent) {
                        doc.setFillColor(...hexToRgb(colors.accent));
                        doc.rect(x, y, at(2), height, "F");
                    }

                    doc.setFontSize(slotFontSize);
                    doc.setTextColor(...hexToRgb(colors.label));
                    doc.text(String(slot.slotNumber), x + width / 2, y + height / 2, { align: "center", baseline: "middle" });
                }

                cursorY = originY + at(faceplate.height) + 6;

                doc.setFontSize(8);
                doc.setTextColor(100);
                doc.text(
                    "Legend: green = Active, grey = Inactive, red = Down, dashed = not documented. Left accent bar: purple = Trunk, orange = Routed, blue = LACP.",
                    margin,
                    cursorY,
                );
                cursorY += 6;
            }

            const placedRows = faceplate.slots
                .filter((slot) => slot.port)
                .map((slot) => {
                    const port = slot.port as NetworkPortRow;
                    return [
                        String(slot.slotNumber),
                        port.portName,
                        port.status || "-",
                        [port.speed, port.mediaType].filter(Boolean).join(" / ") || "-",
                        logicalConfig(port),
                        port.connectedToDeviceName ? `${port.connectedToDeviceName} (${port.connectedToPortName || "?"})` : "-",
                        port.description || "-",
                    ];
                });

            const unplacedRows = faceplate.unplaced.map((port) => [
                "-",
                port.portName,
                port.status || "-",
                [port.speed, port.mediaType].filter(Boolean).join(" / ") || "-",
                logicalConfig(port),
                port.connectedToDeviceName ? `${port.connectedToDeviceName} (${port.connectedToPortName || "?"})` : "-",
                port.description || "-",
            ]);

            autoTable(doc, {
                startY: cursorY,
                head: [["Slot", "Interface", "Status", "Media & Speed", "Logical Config", "Connects To", "Description"]],
                body: [...placedRows, ...unplacedRows],
                theme: "striped",
                headStyles: { fillColor: [15, 118, 110] },
                styles: { fontSize: 8 },
                columnStyles: { 0: { cellWidth: 12 }, 6: { cellWidth: 45 } },
            });

            const safeName = deviceName.replace(/[^a-zA-Z0-9-_]/g, "_");
            doc.save(`Faceplate_${safeName}_${new Date().toISOString().split("T")[0]}.pdf`);
        } catch (error) {
            console.error("Faceplate PDF export failed", error);
            alert("Gagal membuat PDF dokumentasi faceplate.");
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <ActionButton
            type="button"
            onClick={handleExport}
            isPending={isExporting}
            icon={<FileText className="size-4" />}
            variant="secondary"
            title="Download dokumentasi faceplate dan port sebagai PDF"
        >
            Export PDF
        </ActionButton>
    );
}
