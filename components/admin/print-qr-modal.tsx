"use client";

import { useState, useEffect } from "react";
import { generateDeviceQR } from "@/actions/qr";
import { X, Printer, Loader2, QrCode } from "lucide-react";

interface PrintQRModalProps {
    deviceId: number;
    deviceName: string;
    onClose: () => void;
}

export default function PrintQRModal({ deviceId, deviceName, onClose }: PrintQRModalProps) {
    const [qrData, setQrData] = useState<{ url: string; scanLink: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        async function fetchQR() {
            setLoading(true);
            const res = await generateDeviceQR(deviceId);
            if (res.success && res.qrDataUrl && res.scanUrl) {
                setQrData({ url: res.qrDataUrl, scanLink: res.scanUrl });
            } else {
                setError(res.message || "Failed to load QR Code");
            }
            setLoading(false);
        }
        fetchQR();
    }, [deviceId]);

    const handlePrint = () => {
        if (!qrData) return;

        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

        printWindow.document.write(`
            <html>
                <head>
                    <title>Print QR - ${deviceName}</title>
                    <style>
                        body {
                            font-family: system-ui, -apple-system, sans-serif;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            height: 100vh;
                            margin: 0;
                            background: white;
                        }
                        .qr-card {
                            border: 2px solid #000;
                            padding: 24px;
                            border-radius: 12px;
                            text-align: center;
                            width: 300px;
                        }
                        img {
                            width: 100%;
                            height: auto;
                            margin-bottom: 16px;
                        }
                        h2 {
                            margin: 0 0 8px 0;
                            font-size: 20px;
                            color: #000;
                        }
                        p {
                            margin: 0;
                            font-size: 12px;
                            color: #666;
                            word-break: break-all;
                        }
                        .footer {
                            margin-top: 16px;
                            font-size: 10px;
                            color: #000;
                            font-weight: bold;
                        }
                    </style>
                </head>
                <body>
                    <div class="qr-card">
                        <h2>${deviceName}</h2>
                        <img src="${qrData.url}" alt="QR Code for ${deviceName}" />
                        <p>Scan to Audit</p>
                        <div class="footer">DC Check System</div>
                    </div>
                    <script>
                        window.onload = () => {
                            window.print();
                            setTimeout(() => window.close(), 500);
                        };
                    </script>
                </body>
            </html>
        `);
        printWindow.document.close();
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
            <div className="bg-ops-surface rounded-lg shadow-xl max-w-sm w-full relative">
                <button
                    onClick={onClose}
                    className="absolute right-4 top-4 text-ops-muted hover:text-ops-muted dark:hover:text-ops-muted"
                >
                    <X className="h-5 w-5" />
                </button>

                <div className="p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-ops-info-soft text-ops-info rounded-lg">
                            <QrCode className="h-6 w-6" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-ops-text">Device QR Code</h3>
                            <p className="text-sm text-ops-subtle dark:text-ops-muted">{deviceName}</p>
                        </div>
                    </div>

                    <div className="flex flex-col items-center justify-center min-h-[250px] bg-ops-surface/50 rounded-lg border border-ops-border p-6 mb-6">
                        {loading ? (
                            <Loader2 className="h-8 w-8 animate-spin text-ops-muted" />
                        ) : error ? (
                            <p className="text-ops-danger text-sm text-center">{error}</p>
                        ) : qrData ? (
                            <div className="text-center w-full">
                                <div className="bg-white p-3 rounded-xl border-2 border-ops-border dark:border-ops-border-strong shadow-sm mx-auto mb-4 inline-block">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={qrData.url} alt={`QR Code for ${deviceName}`} className="w-48 h-48" />
                                </div>
                                <p className="text-xs text-ops-subtle break-all px-2 font-mono bg-ops-surface-raised rounded p-2">
                                    {qrData.scanLink}
                                </p>
                            </div>
                        ) : null}
                    </div>

                    <div className="flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-ops-muted bg-ops-surface border border-ops-border-strong rounded-md hover:bg-ops-surface dark:hover:bg-ops-surface-raised"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handlePrint}
                            disabled={loading || !!error || !qrData}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-ops-accent-fg bg-ops-accent rounded-md hover:bg-ops-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Printer className="h-4 w-4" />
                            Print Label
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
