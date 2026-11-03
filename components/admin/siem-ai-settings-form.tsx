"use client";

import { testSiemAiConnection } from "@/actions/siem-ai";
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
  aiRegenerateCooldownSec: number;
};

export default function SiemAiSettingsForm({ initialData }: { initialData: SiemAiSettingsData }) {
  const router = useRouter();
  const [state, action, isPending] = useActionState(updateSiemAiSettings, undefined);
  const [testState, testAction, isTesting] = useActionState(testSiemAiConnection, undefined);
  const [enabled, setEnabled] = useState(initialData.aiEnabled);
  const [probe] = useState<{ requiresKey: boolean; status: number; error?: string } | null>(null);

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  // Surface a soft warning when the test-connection error indicates the gateway
  // requires an API key. Avoids hard-coding the gateway URL in the UI.
  const lastTest = testState as
    | { ok: boolean; message: string; requiresKey?: boolean }
    | undefined;
  const needsKey = Boolean(
    (lastTest && !lastTest.ok && lastTest.requiresKey) ||
      (probe?.requiresKey && !initialData.aiApiKeyConfigured),
  );

  return (
    <form action={action} className="mt-6 max-w-5xl space-y-4 rounded-2xl border border-ops-border/50 bg-ops-surface-raised/40 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">SIEM AI Analysis</h2>
          <p className="mt-1 text-xs text-ops-muted">Konfigurasi OpenAI-compatible untuk 9router/provider /chat/completions. API key opsional bila router memegang kredensial. Environment variables menimpa nilai tersimpan.</p>
        </div>
        <span className={`inline-flex h-7 w-fit items-center rounded-full border px-3 text-xs font-medium ${initialData.aiReady ? "border-ops-success/25 bg-ops-success-soft text-ops-success" : "border-ops-warning/25 bg-ops-warning-soft text-ops-warning"}`}>
          {initialData.aiReady ? "Siap" : "Belum lengkap"}
        </span>
      </div>

      {needsKey && (
        <div className="rounded-lg border border-ops-warning/25 bg-ops-warning-soft p-3 text-sm text-ops-warning">
          Endpoint ini sepertinya membutuhkan API key. Isi kolom API Key lalu coba lagi, atau simpan dulu agar perubahan dipakai oleh test connection.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium text-ops-muted">
          Enabled
          <select name="aiEnabled" value={enabled ? "true" : "false"} onChange={(event) => setEnabled(event.target.value === "true")} className="h-10 w-full rounded-lg border border-ops-border bg-ops-surface px-3 text-sm text-white">
            <option value="false">Disabled</option>
            <option value="true">Enabled</option>
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-ops-muted">
          Endpoint URL
          <input name="aiEndpointUrl" defaultValue={initialData.aiEndpointUrl} required placeholder="https://api.9router.example/v1/chat/completions" className="h-10 w-full rounded-lg border border-ops-border bg-ops-surface px-3 font-mono text-sm text-white" />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-ops-muted">
          API Key <span className="text-xs font-normal text-ops-subtle">(opsional)</span>
          <input name="aiApiKey" type="password" autoComplete="off" placeholder={initialData.aiApiKeyConfigured ? "Token tersimpan; isi hanya untuk mengganti" : "Kosongkan jika router sudah memegang kredensial"} className="h-10 w-full rounded-lg border border-ops-border bg-ops-surface px-3 font-mono text-sm text-white" />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-ops-muted">
          Model
          <input name="aiDefaultModel" defaultValue={initialData.aiDefaultModel} required placeholder="anthropic/claude-sonnet-4.6" className="h-10 w-full rounded-lg border border-ops-border bg-ops-surface px-3 font-mono text-sm text-white" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium text-ops-muted">
            Sample Events
            <input name="aiMaxSampleEvents" type="number" min="1" max="20" defaultValue={initialData.aiMaxSampleEvents} className="h-10 w-full rounded-lg border border-ops-border bg-ops-surface px-3 text-sm text-white" />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-ops-muted">
            Max Raw Length
            <input name="aiMaxRawLength" type="number" min="200" max="10000" defaultValue={initialData.aiMaxRawLength} className="h-10 w-full rounded-lg border border-ops-border bg-ops-surface px-3 text-sm text-white" />
          </label>
        </div>
        <label className="space-y-1.5 text-sm font-medium text-ops-muted">
          Regeneration Cooldown (seconds)
          <input name="aiRegenerateCooldownSec" type="number" min="0" max="86400" defaultValue={initialData.aiRegenerateCooldownSec} className="h-10 w-full rounded-lg border border-ops-border bg-ops-surface px-3 text-sm text-white" />
          <span className="block text-xs font-normal text-ops-subtle">0 = selalu izinkan regenerate manual. Default 3600 (1 jam).</span>
        </label>
      </div>

      {state?.errors && <div className="rounded-lg border border-ops-danger/20 bg-ops-danger-soft p-3 text-sm text-ops-danger">{Object.values(state.errors).flat().join(" ")}</div>}
      {state?.message && !state.success && <div className="rounded-lg border border-ops-danger/20 bg-ops-danger-soft p-3 text-sm text-ops-danger">{state.message}</div>}
      {state?.success && <div className="rounded-lg border border-ops-success/20 bg-ops-success-soft p-3 text-sm text-ops-success">SIEM AI settings saved.</div>}

      {testState && (
        <div className={`rounded-lg border p-3 text-sm ${testState.ok ? "border-ops-success/20 bg-ops-success-soft text-ops-success" : "border-ops-danger/20 bg-ops-danger-soft text-ops-danger"}`}>
          {testState.message}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <ActionButton type="submit" formAction={testAction} variant="secondary" isPending={isTesting}>Test Connection</ActionButton>
        <ActionButton type="submit" isPending={isPending}>Save SIEM AI Settings</ActionButton>
      </div>
    </form>
  );
}
