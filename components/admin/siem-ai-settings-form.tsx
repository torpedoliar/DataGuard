"use client";

import { testSiemAiConnection } from "@/actions/siem-ai";
import { updateSiemAiSettings } from "@/actions/siem-settings";
import ActionButton from "@/components/ui/action-button";
import StatusBadge from "@/components/ui/status-badge";
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
    <form action={action} className="ops-panel max-w-5xl space-y-4 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">SIEM AI analysis</h2>
          <p className="mt-0.5 text-[13px] text-ops-muted">Konfigurasi OpenAI-compatible untuk 9router/provider /chat/completions. API key opsional bila router memegang kredensial. Environment variables menimpa nilai tersimpan.</p>
        </div>
        <StatusBadge tone={initialData.aiReady ? "success" : "warning"} dot>
          {initialData.aiReady ? "Siap" : "Belum lengkap"}
        </StatusBadge>
      </div>

      {needsKey && (
        <div className="rounded-md border border-ops-warning/25 bg-ops-warning-soft px-3 py-2.5 text-[13px] text-ops-warning">
          Endpoint ini sepertinya membutuhkan API key. Isi kolom API Key lalu coba lagi, atau simpan dulu agar perubahan dipakai oleh test connection.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium text-ops-muted">
          Enabled
          <select name="aiEnabled" value={enabled ? "true" : "false"} onChange={(event) => setEnabled(event.target.value === "true")} className="ops-input h-9 w-full px-3 text-sm">
            <option value="false">Disabled</option>
            <option value="true">Enabled</option>
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-ops-muted">
          Endpoint URL
          <input name="aiEndpointUrl" defaultValue={initialData.aiEndpointUrl} required placeholder="https://api.9router.example/v1/chat/completions" className="ops-input h-9 w-full px-3 font-mono text-sm" />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-ops-muted">
          API Key <span className="text-xs font-normal text-ops-subtle">(opsional)</span>
          <input name="aiApiKey" type="password" autoComplete="off" placeholder={initialData.aiApiKeyConfigured ? "Token tersimpan; isi hanya untuk mengganti" : "Kosongkan jika router sudah memegang kredensial"} className="ops-input h-9 w-full px-3 font-mono text-sm" />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-ops-muted">
          Model
          <input name="aiDefaultModel" defaultValue={initialData.aiDefaultModel} required placeholder="anthropic/claude-sonnet-4.6" className="ops-input h-9 w-full px-3 font-mono text-sm" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium text-ops-muted">
            Sample Events
            <input name="aiMaxSampleEvents" type="number" min="1" max="20" defaultValue={initialData.aiMaxSampleEvents} className="ops-input h-9 w-full px-3 text-sm" />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-ops-muted">
            Max Raw Length
            <input name="aiMaxRawLength" type="number" min="200" max="10000" defaultValue={initialData.aiMaxRawLength} className="ops-input h-9 w-full px-3 text-sm" />
          </label>
        </div>
        <label className="space-y-1.5 text-sm font-medium text-ops-muted">
          Regeneration Cooldown (seconds)
          <input name="aiRegenerateCooldownSec" type="number" min="0" max="86400" defaultValue={initialData.aiRegenerateCooldownSec} className="ops-input h-9 w-full px-3 text-sm" />
          <span className="block text-xs font-normal text-ops-subtle">0 = selalu izinkan regenerate manual. Default 3600 (1 jam).</span>
        </label>
      </div>

      {state?.errors && <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">{Object.values(state.errors).flat().join(" ")}</div>}
      {state?.message && !state.success && <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">{state.message}</div>}
      {state?.success && <div className="rounded-md border border-ops-success/25 bg-ops-success-soft px-3 py-2.5 text-[13px] text-ops-success">SIEM AI settings saved.</div>}

      {testState && (
        <div className={`rounded-md border px-3 py-2.5 text-[13px] ${testState.ok ? "border-ops-success/25 bg-ops-success-soft text-ops-success" : "border-ops-danger/25 bg-ops-danger-soft text-ops-danger"}`}>
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
