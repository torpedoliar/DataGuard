"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { saveNcmSettings, testNcmConnection } from "@/actions/ncm-settings";
import type { NcmSettingsData, NcmSiteConfig } from "@/actions/ncm-settings";
import ActionButton from "@/components/ui/action-button";

function formatLastSeen(value: Date | null): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString();
}

function SiteRow({ site }: { site: NcmSiteConfig }) {
    const router = useRouter();
    const [saveState, saveAction, isSaving] = useActionState(saveNcmSettings, undefined);
    const [testState, testAction, isTesting] = useActionState(testNcmConnection, undefined);

    useEffect(() => {
        if (saveState?.success || testState?.ok) router.refresh();
    }, [saveState?.success, testState?.ok, router]);

    const lastSeen = formatLastSeen(site.lastSeenAt);

    return (
        <form action={saveAction} className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <input type="hidden" name="ncmSiteId" value={site.siteId} />
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{site.siteName}</span>
                    {site.apiKeyConfigured && (
                        <span className="inline-flex h-6 items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 text-[11px] font-medium text-emerald-300">
                            Terkonfigurasi
                        </span>
                    )}
                </div>
                {lastSeen && (
                    <span className="text-[11px] text-slate-400">Terakhir terlihat: {lastSeen}</span>
                )}
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm font-medium text-slate-300">
                    URL API NCM <span className="text-xs font-normal text-slate-500">(kosong = tidak aktif)</span>
                    <input
                        name="ncmUrl"
                        defaultValue={site.url}
                        placeholder="http://10.10.6.10:9443"
                        className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white"
                    />
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-300">
                    Admin API Key <span className="text-xs font-normal text-slate-500">(kosong = biarkan tersimpan)</span>
                    <input
                        name="ncmAdminApiKey"
                        type="password"
                        autoComplete="off"
                        placeholder={site.apiKeyConfigured ? "Key tersimpan; isi hanya untuk mengganti" : "Admin API key aplikasi NCM"}
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

export default function NcmSettingsForm({ initialData }: { initialData: NcmSettingsData }) {
    return (
        <div className="mt-6 max-w-5xl space-y-4 rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
            <div>
                <h2 className="text-sm font-semibold text-white">NCM Connection</h2>
                <p className="mt-1 text-xs text-slate-400">
                    Koneksi per site ke aplikasi NCM (switch backups/reviews). Setiap site memakai
                    instance NCM sendiri; tombol Test Connection memakai config site tersebut.
                    Admin API key disimpan terenkripsi.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                    Catatan Docker: <span className="font-mono">localhost</span> dari dalam container menunjuk ke container itu
                    sendiri - pakai IP LAN host atau <span className="font-mono">http://host.docker.internal:9443</span>.
                </p>
            </div>

            <div className="space-y-3">
                {initialData.sites.map((site) => (
                    <SiteRow key={site.siteId} site={site} />
                ))}
            </div>
        </div>
    );
}
