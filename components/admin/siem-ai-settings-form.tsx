"use client";

import { updateSiemAiSettings } from "@/actions/siem-settings";
import ActionButton from "@/components/ui/action-button";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

type SiemAiSettingsData = {
  aiEnabled: boolean;
  aiEndpointUrl: string;
  aiApiKeyConfigured: boolean;
  aiDefaultModel: string;
  aiReady: boolean;
  aiMaxSampleEvents: number;
  aiMaxRawLength: number;
};

export default function SiemAiSettingsForm({ initialData }: { initialData: SiemAiSettingsData }) {
  const router = useRouter();
  const [state, action, isPending] = useActionState(updateSiemAiSettings, undefined);
  const [enabled, setEnabled] = useState(initialData.aiEnabled);

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  return (
    <form action={action} className="mt-6 max-w-5xl space-y-4 rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">SIEM AI Analysis</h2>
          <p className="mt-1 text-xs text-slate-400">Konfigurasi OpenAI-compatible untuk 9router/provider /chat/completions. API key opsional bila router memegang kredensial. Environment variables menimpa nilai tersimpan.</p>
        </div>
        <span className={`inline-flex h-7 w-fit items-center rounded-full border px-3 text-xs font-medium ${initialData.aiReady ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border-amber-400/25 bg-amber-400/10 text-amber-300"}`}>
          {initialData.aiReady ? "Siap" : "Belum lengkap"}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium text-slate-300">
          Enabled
          <select name="aiEnabled" value={enabled ? "true" : "false"} onChange={(event) => setEnabled(event.target.value === "true")} className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white">
            <option value="false">Disabled</option>
            <option value="true">Enabled</option>
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-slate-300">
          Endpoint URL
          <input name="aiEndpointUrl" defaultValue={initialData.aiEndpointUrl} required placeholder="https://api.9router.example/v1/chat/completions" className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white" />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-slate-300">
          API Key <span className="text-xs font-normal text-slate-500">(opsional)</span>
          <input name="aiApiKey" type="password" autoComplete="off" placeholder={initialData.aiApiKeyConfigured ? "Token tersimpan; isi hanya untuk mengganti" : "Kosongkan jika router sudah memegang kredensial"} className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white" />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-slate-300">
          Model
          <input name="aiDefaultModel" defaultValue={initialData.aiDefaultModel} required placeholder="anthropic/claude-sonnet-4.6" className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium text-slate-300">
            Sample Events
            <input name="aiMaxSampleEvents" type="number" min="1" max="20" defaultValue={initialData.aiMaxSampleEvents} className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white" />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-300">
            Max Raw Length
            <input name="aiMaxRawLength" type="number" min="200" max="10000" defaultValue={initialData.aiMaxRawLength} className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white" />
          </label>
        </div>
      </div>

      {state?.errors && <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">{Object.values(state.errors).flat().join(" ")}</div>}
      {state?.message && !state.success && <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">{state.message}</div>}
      {state?.success && <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300">SIEM AI settings saved.</div>}

      <div className="flex justify-end">
        <ActionButton type="submit" isPending={isPending}>Save SIEM AI Settings</ActionButton>
      </div>
    </form>
  );
}
