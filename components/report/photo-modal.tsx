"use client";

import { X, ZoomIn, ZoomOut, Download } from "lucide-react";
import { useState } from "react";

interface PhotoModalProps {
    photoPath: string;
    deviceName?: string;
    onClose: () => void;
}

export default function PhotoModal({ photoPath, deviceName, onClose }: PhotoModalProps) {
    const [zoom, setZoom] = useState(1);

    const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.5, 3));
    const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.5, 0.5));
    const handleReset = () => setZoom(1);

    const handleDownload = async () => {
        try {
            const response = await fetch(photoPath);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `photo-${Date.now()}.jpg`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error("Download failed:", error);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div
                className="relative max-w-7xl max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <div className="text-white">
                        <h3 className="text-lg font-semibold">
                            {deviceName || "Device Photo"}
                        </h3>
                        <p className="text-sm text-slate-400">
                            Zoom: {Math.round(zoom * 100)}%
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleZoomOut}
                            disabled={zoom <= 0.5}
                            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="Zoom out"
                        >
                            <ZoomOut className="h-5 w-5" />
                        </button>
                        <button
                            onClick={handleReset}
                            className="px-3 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
                        >
                            Reset
                        </button>
                        <button
                            onClick={handleZoomIn}
                            disabled={zoom >= 3}
                            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="Zoom in"
                        >
                            <ZoomIn className="h-5 w-5" />
                        </button>
                        <button
                            onClick={handleDownload}
                            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                            title="Download"
                        >
                            <Download className="h-5 w-5" />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors ml-2"
                            title="Close"
                        >
                            <X className="h-6 w-6" />
                        </button>
                    </div>
                </div>

                {/* Image */}
                <div className="flex-1 flex items-center justify-center overflow-hidden rounded-lg bg-slate-900/50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={photoPath}
                        alt={deviceName || "Device photo"}
                        className="max-h-[70vh] max-w-full object-contain transition-transform duration-200"
                        style={{ transform: `scale(${zoom})` }}
                    />
                </div>
            </div>
        </div>
    );
}
