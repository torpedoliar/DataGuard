"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { saveNetworkDocSettings, testNetworkDocConnection } from "@/actions/network-doc-settings";
import type { NetworkDocSettingsData } from "@/actions/network-doc-settings";
import ActionButton from "@/components/ui/action-button";

const INTERVAL_OPTIONS = [
    { value: "", label: "Default (1 jam)" },
    { value: "3600000", label: "1 jam" },
    { value: "21600000", label: "6 jam" },
    { value: "43200000", label: "12 jam" },
    { value: "86400000", label: "24 jam" },
];

export default function NetworkDocSettingsForm({ initialData }: { initialData: NetworkDocSettingsData }) {
    const router = useRouter();
    const [state, action, isPending] = useActionState(saveNetworkDocSettings, undefined);
    const [testState, testAction, isTesting] = useActionState(testNetworkDocConnection, undefined);

    useEffect(() => {
        if (state?.success) router.refresh();
    }, [state?.success, router]);

    const envOverrides = [
        initialData.envOverridesUrl ? "URL" : null,
        initialData.envOverridesKey ? "API key" : null,
        initialData.envOverridesSiteId ? "Site ID" : null,
        initialData.envOverridesInterval ? "Interval" : null,
    ].filter(Boolean);

    // Fallback options so a stored value absent from the fixed lists (e.g. a
    // site that was deleted, or a custom interval) still renders — otherwise
    // the select submits "" and an unrelated save silently clears the config.
    const intervalOptions = INTERVAL_OPTIONS.some(
        (option) => option.value === String(initialData.networkDocIntervalMs),
    )
        ? INTERVAL_OPTIONS
        : [
            ...INTERVAL_OPTIONS,
            {
                value: String(initialData.networkDocIntervalMs),
                label: `Custom (${Math.round((initialData.networkDocIntervalMs ?? 0) / 60_000)} menit)`,
            },
        ];
    const siteOptions = initialData.sites.some((site) => site.id === initialData.networkDocSiteId)
        ? initialData.sites
        : initialData.networkDocSiteId !== null
            ? [
                { id: initialData.networkDocSiteId, name: `Site #${initialData.networkDocSiteId} (tidak ada di daftar)` },
                ...initialData.sites,
            ]
            : initialData.sites;

    return (
        <form action={action} className="mt-6 max-w-5xl space-y-4 rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="text-sm font-semibold text-white">Network Docs Sync</h2>
                    <p className="mt-1 text-xs text-slate-400">
                        Sumber dokumentasi jaringan (aplikasi backup switch). Dipakai oleh worker terjadwal dan tombol sync di{" "}
                        <span className="font-mono">/admin/network-docs</span>. API key disimpan terenkripsi.
                    </p>
                </div>
                <span className={`inline-flex h-7 w-fit items-center rounded-full border px-3 text-xs font-medium ${initialData.networkDocApiKeyConfigured ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border-amber-400/25 bg-amber-400/10 text-amber-300"}`}>
                    {initialData.networkDocApiKeyConfigured ? "Terkonfigurasi" : "Belum lengkap"}
                </span>
            </div>

            {envOverrides.length > 0 && (
                <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-200">
                    Environment override aktif untuk: {envOverrides.join(", ")} — nilai dari .env menang di atas pengaturan ini.
                    {initialData.envOverridesUrl && initialData.effectiveUrl && (
                        <div className="mt-1 font-mono text-xs">URL yang benar-benar dipakai: {initialData.effectiveUrl}</div>
                    )}
                </div>
            )}

            <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-3 text-xs text-slate-400">
                Catatan: jika dc-check berjalan di Docker, <span className="font-mono">localhost</span> dari dalam container
                menunjuk ke container itu sendiri — pakai IP LAN host (mis. <span className="font-mono">http://192.168.2.3:8443</span>)
                atau <span className="font-mono">http://host.docker.internal:8443</span>.
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5 text-sm font-medium text-slate-300 md:col-span-2">
                    URL API
                    <input
                        name="networkDocUrl"
                        defaultValue={initialData.networkDocUrl}
                        placeholder="http://10.10.6.9:8443"
                        className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white"
                    />
                </label>
                <label className="space-y-1.5 text-sm font-medium text-slate-300">
                    API Key <span className="text-xs font-normal text-slate-500">(kosongkan = biarkan tersimpan)</span>
                    <input
                        name="networkDocApiKey"
                        type="password"
                        autoComplete="off"
                        placeholder={initialData.networkDocApiKeyConfigured ? "Key tersimpan; isi hanya untuk mengganti" : "X-API-Key aplikasi dokumentasi jaringan"}
                        className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white"
                    />
                </label>
                <label className="space-y-1.5 text-sm font-medium text-slate-300">
                    Site untuk sinkronisasi (worker)
                    <select
                        name="networkDocSiteId"
                        defaultValue={initialData.networkDocSiteId?.toString() ?? ""}
                        className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white"
                    >
                        <option value="">— Belum dipilih —</option>
                        {siteOptions.map((site) => (
                            <option key={site.id} value={site.id}>{site.name}</option>
                        ))}
                    </select>
                    <span className="block text-xs font-normal text-slate-500">Tombol manual di /admin/network-docs memakai site aktif saat itu.</span>
                </label>
                <label className="space-y-1.5 text-sm font-medium text-slate-300">
                    Interval worker terjadwal
                    <select
                        name="networkDocIntervalMs"
                        defaultValue={initialData.networkDocIntervalMs?.toString() ?? ""}
                        className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white"
                    >
                        {intervalOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </label>
            </div>

            {state?.errors && (
                <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">
                    {Object.values(state.errors as Record<string, string[]>).flat().join(" ")}
                </div>
            )}
            {state?.message && !state.success && (
                <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">{state.message}</div>
            )}
            {state?.success && (
                <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300">Pengaturan Network Docs disimpan.</div>
            )}

            {testState && (
                <div className={`rounded-lg border p-3 text-sm ${testState.ok ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-red-400/20 bg-red-400/10 text-red-300"}`}>
                    {testState.message}
                </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <ActionButton type="submit" formAction={testAction} variant="secondary" isPending={isTesting}>Test Connection</ActionButton>
                <ActionButton type="submit" isPending={isPending}>Save Network Docs Settings</ActionButton>
            </div>
        </form>
    );
}
