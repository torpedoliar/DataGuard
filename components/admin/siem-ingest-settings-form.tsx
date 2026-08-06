"use client";

import { updateSiemIngestSettings } from "@/actions/siem-settings";
import ActionButton from "@/components/ui/action-button";
import { siemSeverities, type SiemSeverity } from "@/lib/siem/types";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

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

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  return (
    <form action={action} className="mt-6 max-w-5xl space-y-4 rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
      <div>
        <h2 className="text-sm font-semibold text-white">SIEM Ingest</h2>
        <p className="mt-1 text-xs text-slate-400">
          Tentukan severity minimum untuk alert dan retensi data per-site. Source syslog harus dipetakan eksplisit ke site ini.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium text-slate-300">
          Alert Minimum Severity
          <select
            name="alertMinSeverity"
            defaultValue={initialData.alertMinSeverity}
            className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white"
          >
            {siemSeverities.map((severity) => (
              <option key={severity} value={severity}>
                {severity}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">Finding di bawah severity ini tidak akan masuk antrean alert.</span>
        </label>
      </div>

      <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4">
        <h3 className="text-sm font-semibold text-white">Retention (hari)</h3>
        <p className="mt-1 text-xs text-slate-400">Data lebih tua dari batas ini akan dihapus otomatis oleh retention worker.</p>
        <div className="mt-3 grid gap-4 md:grid-cols-4">
          <label className="space-y-1.5 text-sm font-medium text-slate-300">
            Raw Events
            <input
              name="rawRetentionDays"
              type="number"
              min={1}
              max={3650}
              defaultValue={initialData.rawRetentionDays}
              className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white"
            />
            <span className="text-xs text-slate-500">Default: 90 hari</span>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-300">
            Events
            <input
              name="eventRetentionDays"
              type="number"
              min={1}
              max={3650}
              defaultValue={initialData.eventRetentionDays}
              className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white"
            />
            <span className="text-xs text-slate-500">Default: 180 hari</span>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-300">
            Findings
            <input
              name="findingRetentionDays"
              type="number"
              min={1}
              max={3650}
              defaultValue={initialData.findingRetentionDays}
              className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white"
            />
            <span className="text-xs text-slate-500">Default: 365 hari</span>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-300">
            Alerts
            <input
              name="alertRetentionDays"
              type="number"
              min={1}
              max={3650}
              defaultValue={initialData.alertRetentionDays}
              className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white"
            />
            <span className="text-xs text-slate-500">Default: 365 hari</span>
          </label>
        </div>
      </div>

      {state?.errors && (
        <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">
          {Object.values(state.errors).flat().join(" ")}
        </div>
      )}
      {state?.message && !state.success && (
        <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">{state.message}</div>
      )}
      {state?.success && (
        <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300">SIEM ingest settings tersimpan.</div>
      )}

      <div className="flex justify-end">
        <ActionButton type="submit" isPending={isPending}>
          Save SIEM Ingest Settings
        </ActionButton>
      </div>
    </form>
  );
}
