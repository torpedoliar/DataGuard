"use client";

import { useState, useEffect } from "react";
import { generateDeviceQR } from "@/actions/qr";
import ActionButton from "@/components/ui/action-button";
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
            <div className="relative w-full max-w-sm rounded-lg border border-ops-border bg-ops-surface shadow-xl">
                <div className="absolute right-3 top-3">
                    <ActionButton type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close" title="Close">
                        <X aria-hidden="true" className="size-4" />
                    </ActionButton>
                </div>

                <div className="p-5">
                    <div className="mb-6 flex items-center gap-3">
                        <div className="rounded-lg bg-ops-info-soft p-2 text-ops-info">
                            <QrCode className="size-5" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Device QR code</h3>
                            <p className="truncate text-[13px] text-ops-muted">{deviceName}</p>
                        </div>
                    </div>

                    <div className="mb-6 flex min-h-[250px] flex-col items-center justify-center rounded-md border border-ops-border bg-ops-surface-raised/60 p-6">
                        {loading ? (
                            <Loader2 className="h-8 w-8 animate-spin text-ops-muted" />
                        ) : error ? (
                            <p className="text-ops-danger text-sm text-center">{error}</p>
                        ) : qrData ? (
                            <div className="text-center w-full">
                                <div className="mb-4 inline-block rounded-lg border border-ops-border bg-white p-3 shadow-sm">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={qrData.url} alt={`QR Code for ${deviceName}`} className="w-48 h-48" />
                                </div>
                                <p className="break-all rounded-md bg-ops-surface-raised p-2 font-mono text-xs text-ops-muted">
                                    {qrData.scanLink}
                                </p>
                            </div>
                        ) : null}
                    </div>

                    <div className="flex justify-end gap-3">
                        <ActionButton type="button" variant="secondary" onClick={onClose}>
                            Cancel
                        </ActionButton>
                        <ActionButton type="button" onClick={handlePrint} disabled={loading || !!error || !qrData} icon={<Printer className="size-4" />}>
                            Print label
                        </ActionButton>
                    </div>
                </div>
            </div>
        </div>
    );
}
