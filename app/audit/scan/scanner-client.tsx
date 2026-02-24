"use client";

import { useEffect, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { useRouter } from "next/navigation";
import { ArrowLeft, ScanLine } from "lucide-react";
import Link from "next/link";

export default function QRScannerClient() {
    const router = useRouter();
    const [scanError, setScanError] = useState<string | null>(null);

    useEffect(() => {
        // Initialize HTML5 QR Code Scanner
        const scanner = new Html5QrcodeScanner(
            "reader",
            {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0,
            },
            /* verbose= */ false
        );

        function onScanSuccess(decodedText: string) {
            // Check if string is a valid URL matching our format
            try {
                const url = new URL(decodedText);
                const deviceId = url.searchParams.get("deviceId");

                if (deviceId) {
                    scanner.clear();
                    router.push(`/audit/new?deviceId=${deviceId}`);
                } else {
                    setScanError("Invalid DC Check QR Code format.");
                }
            } catch (e) {
                setScanError("Scanned text is not a valid URL.");
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        function onScanFailure(error: any) {
            // Ignore ongoing frame scanning errors, only log actual issues
        }

        scanner.render(onScanSuccess, onScanFailure);

        return () => {
            scanner.clear().catch(error => {
                console.error("Failed to clear html5QrcodeScanner. ", error);
            });
        };
    }, [router]);

    return (
        <div className="max-w-md mx-auto mt-10 p-6 bg-white dark:bg-card-dark rounded-xl shadow-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-4 mb-6">
                <Link
                    href="/checklist"
                    className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                >
                    <ArrowLeft className="h-5 w-5 text-slate-600 dark:text-slate-300" />
                </Link>
                <div className="flex items-center gap-2">
                    <ScanLine className="h-6 w-6 text-blue-600" />
                    <h1 className="text-xl font-bold text-slate-900 dark:text-white">Scan Device QR</h1>
                </div>
            </div>

            <p className="text-sm text-slate-500 mb-6 font-medium">
                Point your camera at the device QR code to begin the audit checklist instantly.
            </p>

            <div className="rounded-lg overflow-hidden border-2 border-slate-200 dark:border-slate-700 bg-black min-h-[300px] flex items-center justify-center relative">
                <div id="reader" className="w-full text-white" />
            </div>

            {scanError && (
                <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm text-center">
                    {scanError}
                </div>
            )}
        </div>
    );
}
