"use client";

import { useEffect, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { useRouter } from "next/navigation";
import ActionButton from "@/components/ui/action-button";
import PageHeader from "@/components/ui/page-header";
import { AlertTriangle, ArrowLeft, Camera, ScanLine } from "lucide-react";

export default function QRScannerClient() {
  const router = useRouter();
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    let scanner: Html5QrcodeScanner | null = null;

    try {
      scanner = new Html5QrcodeScanner(
        "reader",
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        false,
      );

      function onScanSuccess(decodedText: string) {
        try {
          const url = new URL(decodedText);
          const deviceId = url.searchParams.get("deviceId");

          if (deviceId) {
            scanner?.clear();
            router.push(`/audit/new?deviceId=${deviceId}`);
          } else {
            setScanError("Invalid DC Check QR code format.");
          }
        } catch {
          setScanError("Scanned text is not a valid DC Check URL.");
        }
      }

      function onScanFailure() {
        // Frame-level decode misses are expected while the camera is running.
      }

      scanner.render(onScanSuccess, onScanFailure);
    } catch {
      window.setTimeout(() => {
        setScanError("Camera scanner failed to start. Check browser camera permission and device availability.");
      }, 0);
    }

    return () => {
      scanner?.clear().catch(() => undefined);
    };
  }, [router]);

  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        eyebrow="Operate / QR Scanner"
        title="Scan Device QR"
        description="Use the device QR code to open a prefilled audit entry for the selected asset."
        actions={
          <ActionButton href="/checklist" variant="secondary" icon={<ArrowLeft className="size-4" />}>
            Dashboard
          </ActionButton>
        }
      />

      <section className="ops-panel overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-ops-border bg-ops-surface px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Camera feed</h2>
            <p className="mt-1 text-sm text-ops-muted">Center the QR marker inside the scanner frame.</p>
          </div>
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-ops-accent/12 text-ops-accent">
            <ScanLine className="size-5" />
          </div>
        </div>

        <div className="grid gap-0 lg:grid-cols-[1fr_260px]">
          <div className="min-h-[360px] bg-black p-3">
            <div className="flex min-h-[336px] items-center justify-center rounded-md border border-ops-border bg-black">
              <div
                id="reader"
                className="w-full text-ops-text [&_button]:rounded-md [&_button]:border [&_button]:border-ops-border [&_button]:bg-ops-surface [&_button]:px-3 [&_button]:py-2 [&_button]:text-sm [&_button]:font-semibold [&_button]:text-ops-text [&_select]:rounded-md [&_select]:border [&_select]:border-ops-border [&_select]:bg-ops-bg [&_select]:px-3 [&_select]:py-2 [&_select]:text-sm [&_select]:text-ops-text"
              />
            </div>
          </div>

          <aside className="border-t border-ops-border bg-ops-surface p-5 lg:border-l lg:border-t-0">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-ops-info-soft text-ops-info">
                <Camera className="size-5" />
              </div>
              <div>
                <h3 className="text-[13px] font-semibold text-ops-text">Field scan</h3>
                <p className="mt-1 text-[13px] leading-6 text-ops-muted">
                  Browser camera permission is required. Native phone camera links that open this page still redirect to the audit form.
                </p>
              </div>
            </div>

            {scanError && (
              <div className="mt-5 rounded-md border border-ops-danger/30 bg-ops-danger-soft p-3 text-sm text-ops-danger">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>{scanError}</span>
                </div>
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}
