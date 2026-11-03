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
    <form action={action} className="mt-6 max-w-5xl space-y-4 rounded-2xl border border-ops-border/50 bg-ops-surface-raised/40 p-6">
      <div>
        <h2 className="text-sm font-semibold text-white">SIEM Ingest</h2>
        <p className="mt-1 text-xs text-ops-muted">
          Tentukan severity minimum untuk alert dan retensi data per-site. Source syslog harus dipetakan eksplisit ke site ini.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium text-ops-muted">
          Alert Minimum Severity
          <select
            name="alertMinSeverity"
            defaultValue={initialData.alertMinSeverity}
            className="h-10 w-full rounded-lg border border-ops-border bg-ops-surface px-3 text-sm text-white"
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

      <div className="rounded-lg border border-ops-border/50 bg-ops-surface-raised/40 p-4">
        <h3 className="text-sm font-semibold text-white">Retention (hari)</h3>
        <p className="mt-1 text-xs text-ops-muted">Data lebih tua dari batas ini akan dihapus otomatis oleh retention worker untuk menjaga storage server tetap aman.</p>
        <div className="mt-3 grid gap-4 md:grid-cols-4">
          <label className="space-y-1.5 text-sm font-medium text-ops-muted">
            Raw Events
            <input
              name="rawRetentionDays"
              type="number"
              min={1}
              max={3650}
              defaultValue={initialData.rawRetentionDays}
              className="h-10 w-full rounded-lg border border-ops-border bg-ops-surface px-3 text-sm text-white"
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
              className="h-10 w-full rounded-lg border border-ops-border bg-ops-surface px-3 text-sm text-white"
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
              className="h-10 w-full rounded-lg border border-ops-border bg-ops-surface px-3 text-sm text-white"
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
              className="h-10 w-full rounded-lg border border-ops-border bg-ops-surface px-3 text-sm text-white"
            />
            <span className="text-xs text-ops-subtle">Default: 365 hari</span>
          </label>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-ops-border/50 pt-3">
          <div className="text-xs text-ops-muted">
            <span className="font-semibold text-ops-muted">Pembersihan Otomatis:</span> Berjalan berkala via worker <code className="text-ops-warning/90 font-mono">siem:retention</code> &amp; otomatis terpicu saat setting disimpan.
          </div>
          <button
            type="button"
            disabled={isCleaning}
            onClick={handleManualCleanup}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ops-warning/30 bg-ops-warning-soft px-3 py-1.5 text-xs font-semibold text-ops-warning hover:bg-ops-warning-soft disabled:opacity-50 transition-colors"
          >
            {isCleaning ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Membersihkan Storage...
              </>
            ) : (
              <>
                <Trash2 className="h-3.5 w-3.5" />
                Bersihkan Storage Sekarang
              </>
            )}
          </button>
        </div>

        {cleanResult && (
          <div className={clsx("mt-3 flex items-start gap-2 rounded-lg border p-3 text-xs", cleanResult.success ? "border-ops-success/20 bg-ops-success-soft text-ops-success" : "border-ops-danger/20 bg-ops-danger-soft text-ops-danger")}>
            {cleanResult.success ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ops-success" /> : <AlertCircle className="h-4 w-4 shrink-0 text-ops-danger" />}
            <span>{cleanResult.message}</span>
          </div>
        )}
      </div>

      {state?.errors && (
        <div className="rounded-lg border border-ops-danger/20 bg-ops-danger-soft p-3 text-sm text-ops-danger">
          {Object.values(state.errors).flat().join(" ")}
        </div>
      )}
      {state?.message && !state.success && (
        <div className="rounded-lg border border-ops-danger/20 bg-ops-danger-soft p-3 text-sm text-ops-danger">{state.message}</div>
      )}
      {state?.success && (
        <div className="rounded-lg border border-ops-success/20 bg-ops-success-soft p-3 text-sm text-ops-success">SIEM ingest settings tersimpan dan pembersihan retensi otomatis dijalankan di latar belakang.</div>
      )}

      <div className="flex justify-end">
        <ActionButton type="submit" isPending={isPending}>
          Save SIEM Ingest Settings
        </ActionButton>
      </div>
    </form>
  );
}
