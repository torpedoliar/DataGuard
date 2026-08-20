"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import {
    saveNetworkDocSettings,
    saveNetworkDocWorkerInterval,
    testNetworkDocConnection,
} from "@/actions/network-doc-settings";
import type { NetworkDocSettingsData, NetworkDocSiteConfig } from "@/actions/network-doc-settings";
import ActionButton from "@/components/ui/action-button";

const INTERVAL_OPTIONS = [
    { value: "", label: "Default (1 jam)" },
    { value: "3600000", label: "1 jam" },
    { value: "21600000", label: "6 jam" },
    { value: "43200000", label: "12 jam" },
    { value: "86400000", label: "24 jam" },
];

function SiteRow({ site, envHasUrl, envHasKey }: { site: NetworkDocSiteConfig; envHasUrl: boolean; envHasKey: boolean }) {
    const router = useRouter();
    const [saveState, saveAction, isSaving] = useActionState(saveNetworkDocSettings, undefined);
    const [testState, testAction, isTesting] = useActionState(testNetworkDocConnection, undefined);

    useEffect(() => {
        if (saveState?.success) router.refresh();
    }, [saveState?.success, router]);

    const envDefaultActive = site.usesEnvDefault;

    return (
        <form action={saveAction} className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <input type="hidden" name="networkDocSiteId" value={site.siteId} />
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{site.siteName}</span>
                    {site.apiKeyConfigured && (
                        <span className="inline-flex h-6 items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 text-[11px] font-medium text-emerald-300">
                            Terkonfigurasi
                        </span>
                    )}
                </div>
                {envDefaultActive && (
                    <span className="text-[11px] text-amber-300">
                        Pakai default env (NETWORK_DOC_URL) — kosongkan & simpan untuk hapus
                    </span>
                )}
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm font-medium text-slate-300">
                    URL API <span className="text-xs font-normal text-slate-500">(kosong = tidak aktif)</span>
                    <input
                        name="networkDocUrl"
                        defaultValue={site.url}
                        placeholder={envHasUrl ? "Pakai default dari env" : "http://10.10.6.9:8443"}
                        className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white"
                    />
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-300">
                    API Key <span className="text-xs font-normal text-slate-500">(kosong = biarkan tersimpan)</span>
                    <input
                        name="networkDocApiKey"
                        type="password"
                        autoComplete="off"
                        placeholder={site.apiKeyConfigured ? "Key tersimpan; isi hanya untuk mengganti" : envHasKey ? "Pakai default dari env" : "X-API-Key aplikasi dokumentasi"}
                        className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white"
                    />
                </label>
            </div>

            {saveState?.errors && (
                <div className="mt-3 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">
                    {Object.values(saveState.errors as Record<string, string[]>).flat().join(" ")}
                </div>
            )}
            {saveState?.message && !saveState.success && (
                <div className="mt-3 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">{saveState.message}</div>
            )}
            {testState && (
                <div className={`mt-3 rounded-lg border p-3 text-sm ${testState.ok ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-red-400/20 bg-red-400/10 text-red-300"}`}>
                    {testState.message}
                </div>
            )}

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <ActionButton type="submit" formAction={testAction} variant="secondary" isPending={isTesting}>Test Connection</ActionButton>
                <ActionButton type="submit" isPending={isSaving}>Simpan Site</ActionButton>
            </div>
        </form>
    );
}

export default function NetworkDocSettingsForm({ initialData }: { initialData: NetworkDocSettingsData }) {
    const router = useRouter();
    const [intervalState, intervalAction, isIntervalPending] = useActionState(saveNetworkDocWorkerInterval, undefined);

    useEffect(() => {
        if (intervalState?.success) router.refresh();
    }, [intervalState?.success, router]);

    const intervalOptions = INTERVAL_OPTIONS.some(
        (option) => option.value === String(initialData.workerIntervalMs),
    )
        ? INTERVAL_OPTIONS
        : [
            ...INTERVAL_OPTIONS,
            {
                value: String(initialData.workerIntervalMs),
                label: `Custom (${Math.round((initialData.workerIntervalMs ?? 0) / 60_000)} menit)`,
            },
        ];

    return (
        <div className="mt-6 max-w-5xl space-y-4 rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
            <div>
                <h2 className="text-sm font-semibold text-white">Network Docs Sync</h2>
                <p className="mt-1 text-xs text-slate-400">
                    Konfigurasi per site — setiap site bisa memakai API network-doc sendiri. Worker terjadwal menyinkronkan
                    semua site yang terkonfigurasi; tombol sync di <span className="font-mono">/admin/network-docs</span> memakai
                    config site aktif. API key disimpan terenkripsi.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                    Catatan Docker: <span className="font-mono">localhost</span> dari dalam container menunjuk ke container itu
                    sendiri — pakai IP LAN host atau <span className="font-mono">http://host.docker.internal:8443</span>.
                </p>
            </div>

            {(initialData.envHasUrl || initialData.envHasKey) && (
                <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-200">
                    Environment menyediakan default global (NETWORK_DOC_URL{initialData.envHasKey ? " + NETWORK_DOC_API_KEY" : ""}) — dipakai untuk site yang kolom URL/Key-nya kosong.
                </div>
            )}

            <div className="space-y-3">
                {initialData.sites.map((site) => (
                    <SiteRow key={site.siteId} site={site} envHasUrl={initialData.envHasUrl} envHasKey={initialData.envHasKey} />
                ))}
            </div>

            <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-4">
                <form action={intervalAction} className="flex flex-wrap items-end gap-3">
                    <label className="space-y-1 text-sm font-medium text-slate-300">
                        Interval worker terjadwal (semua site)
                        <select
                            name="networkDocIntervalMs"
                            defaultValue={initialData.workerIntervalMs?.toString() ?? ""}
                            className="h-9 w-full min-w-44 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white"
                        >
                            {intervalOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </label>
                    <ActionButton type="submit" variant="secondary" isPending={isIntervalPending}>Simpan Interval</ActionButton>
                    {initialData.envOverridesInterval && (
                        <span className="text-xs text-amber-300">Env NETWORK_DOC_SYNC_INTERVAL_MS menang bila diisi.</span>
                    )}
                </form>
                {intervalState?.message && !intervalState.success && (
                    <div className="mt-2 rounded-lg border border-red-400/20 bg-red-400/10 p-2 text-sm text-red-300">{intervalState.message}</div>
                )}
                {intervalState?.success && (
                    <div className="mt-2 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-2 text-sm text-emerald-300">Interval disimpan.</div>
                )}
            </div>
        </div>
    );
}