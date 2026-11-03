"use client";

import { updateSiemIngestSettings, runSiemRetentionNow } from "@/actions/siem-settings";
import ActionButton from "@/components/ui/action-button";
import { siemSeverities, type SiemSeverity } from "@/lib/siem/types";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Trash2, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import clsx from "clsx";

export type SiemIngestSettingsData = {
  alertMinSeverity: SiemSeverity;
  rawRetentionDays: number;
  eventRetentionDays: number;
  findingRetentionDays: number;
  alertRetentionDays: number;
};

export default function SiemIngestSettingsForm({ initialData }: { initialData: SiemIngestSettingsData }) {
  const router = useRouter();
  const [state, action, isPending] = useActionState(updateSiemIngestSettings, undefined);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  const handleManualCleanup = async () => {
    if (!confirm("Jalankan pembersihan retensi sekarang untuk membebaskan ruang penyimpanan server?")) {
      return;
    }
    setIsCleaning(true);
    setCleanResult(null);
    try {
      const res = await runSiemRetentionNow();
      setCleanResult(res);
      if (res.success) {
        router.refresh();
      }
    } catch (err) {
      setCleanResult({
        success: false,
        message: `Terjadi kesalahan saat membersihkan: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <form action={action} className="ops-panel max-w-5xl space-y-4 p-5">
      <div>
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">SIEM ingest</h2>
        <p className="mt-0.5 text-[13px] text-ops-muted">
          Tentukan severity minimum untuk alert dan retensi data per-site. Source syslog harus dipetakan eksplisit ke site ini.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium text-ops-muted">
          Alert Minimum Severity
          <select
            name="alertMinSeverity"
            defaultValue={initialData.alertMinSeverity}
            className="ops-input h-9 w-full px-3 text-sm"
          >
            {siemSeverities.map((severity) => (
              <option key={severity} value={severity}>
                {severity}
              </option>
            ))}
          </select>
          <span className="text-xs text-ops-subtle">Finding di bawah severity ini tidak akan masuk antrean alert.</span>
        </label>
      </div>

      <div className="ops-panel-subtle p-4">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Retention (hari)</h3>
        <p className="mt-0.5 text-[13px] text-ops-muted">Data lebih tua dari batas ini akan dihapus otomatis oleh retention worker untuk menjaga storage server tetap aman.</p>
        <div className="mt-3 grid gap-4 md:grid-cols-4">
          <label className="space-y-1.5 text-sm font-medium text-ops-muted">
            Raw Events
            <input
              name="rawRetentionDays"
              type="number"
              min={1}
              max={3650}
              defaultValue={initialData.rawRetentionDays}
              className="ops-input h-9 w-full px-3 text-sm tabular-nums"
            />
            <span className="text-xs text-ops-subtle">Default: 90 hari</span>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-ops-muted">
            Events
            <input
              name="eventRetentionDays"
              type="number"
              min={1}
              max={3650}
              defaultValue={initialData.eventRetentionDays}
              className="ops-input h-9 w-full px-3 text-sm tabular-nums"
            />
            <span className="text-xs text-ops-subtle">Default: 180 hari</span>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-ops-muted">
            Findings
            <input
              name="findingRetentionDays"
              type="number"
              min={1}
              max={3650}
              defaultValue={initialData.findingRetentionDays}
              className="ops-input h-9 w-full px-3 text-sm tabular-nums"
            />
            <span className="text-xs text-ops-subtle">Default: 365 hari</span>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-ops-muted">
            Alerts
            <input
              name="alertRetentionDays"
              type="number"
              min={1}
              max={3650}
              defaultValue={initialData.alertRetentionDays}
              className="ops-input h-9 w-full px-3 text-sm tabular-nums"
            />
            <span className="text-xs text-ops-subtle">Default: 365 hari</span>
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-ops-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-ops-muted">
            <span className="font-medium text-ops-text">Pembersihan Otomatis:</span> Berjalan berkala via worker <code className="font-mono text-ops-warning/90">siem:retention</code> &amp; otomatis terpicu saat setting disimpan.
          </div>
          <button
            type="button"
            disabled={isCleaning}
            onClick={handleManualCleanup}
            className="inline-flex h-9 shrink-0 select-none items-center justify-center gap-2 rounded-md border border-ops-warning/25 bg-ops-warning-soft px-3 text-sm font-medium text-ops-warning transition-colors hover:border-ops-warning/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ops-warning/30 disabled:pointer-events-none disabled:opacity-55"
          >
            {isCleaning ? (
              <>
                <RefreshCw className="size-4 animate-spin" />
                Membersihkan Storage...
              </>
            ) : (
              <>
                <Trash2 className="size-4" />
                Bersihkan Storage Sekarang
              </>
            )}
          </button>
        </div>

        {cleanResult && (
          <div className={clsx("mt-3 flex items-start gap-2 rounded-md border px-3 py-2.5 text-[13px]", cleanResult.success ? "border-ops-success/25 bg-ops-success-soft text-ops-success" : "border-ops-danger/25 bg-ops-danger-soft text-ops-danger")}>
            {cleanResult.success ? <CheckCircle2 className="size-4 shrink-0 text-ops-success" aria-hidden="true" /> : <AlertCircle className="size-4 shrink-0 text-ops-danger" aria-hidden="true" />}
            <span>{cleanResult.message}</span>
          </div>
        )}
      </div>

      {state?.errors && (
        <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">
          {Object.values(state.errors).flat().join(" ")}
        </div>
      )}
      {state?.message && !state.success && (
        <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">{state.message}</div>
      )}
      {state?.success && (
        <div className="rounded-md border border-ops-success/25 bg-ops-success-soft px-3 py-2.5 text-[13px] text-ops-success">SIEM ingest settings tersimpan dan pembersihan retensi otomatis dijalankan di latar belakang.</div>
      )}

      <div className="flex justify-end">
        <ActionButton type="submit" isPending={isPending}>
          Save SIEM Ingest Settings
        </ActionButton>
      </div>
    </form>
  );
}
