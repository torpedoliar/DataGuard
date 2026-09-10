"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { checkNcmNow, saveNcmSettings, saveNcmWebhook, setupNcmWebhook, testNcmConnection } from "@/actions/ncm-settings";
import { saveNetworkDocWorkerInterval } from "@/actions/network-doc-settings";
import type { NcmSettingsData, NcmSiteConfig } from "@/actions/ncm-settings";
import type { NetworkDocSettingsData } from "@/actions/network-doc-settings";
import ActionButton from "@/components/ui/action-button";
import { requiredDgScopes } from "@/lib/ncm-setup";

function formatLastSeen(value: Date | null): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString();
}

// Ticket 14 — one form per site: the NCM connection (URL + admin API key,
// used for backups/reviews AND the network-doc sync) plus the network-doc
// section (interval + per-site override) plus the webhook. The backend
// network-doc table/actions are untouched; saveNcmSettings reuses
// saveNetworkDocSettings verbatim when the form posts networkDocSiteId.
const INTERVAL_OPTIONS = [
    { value: "", label: "Default (1 jam)" },
    { value: "3600000", label: "1 jam" },
    { value: "21600000", label: "6 jam" },
    { value: "43200000", label: "12 jam" },
    { value: "86400000", label: "24 jam" },
];

function WebhookSection({ site }: { site: NcmSiteConfig }) {
    const [setupState, setupAction, isSettingUp] = useActionState(setupNcmWebhook, undefined);
    const [saveState, saveAction] = useActionState(saveNcmWebhook, undefined);

    return (
        <div className="mt-3 rounded-lg border border-slate-700/50 bg-slate-900/40 p-4">
            <form action={setupAction}>
                <input type="hidden" name="ncmSiteId" value={site.siteId} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">Webhook NCM → DG</span>
                        {site.webhookConfigured ? (
                            <span className="inline-flex h-6 items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 text-[11px] font-medium text-emerald-300">
                                Webhook terkonfigurasi
                            </span>
                        ) : (
                            <span className="inline-flex h-6 items-center rounded-full border border-amber-400/25 bg-amber-400/10 px-2 text-[11px] font-medium text-amber-300">
                                Webhook belum dikonfigurasi
                            </span>
                        )}
                    </div>
                    <ActionButton type="submit" isPending={isSettingUp}>Aktifkan Webhook (1 klik)</ActionButton>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                    DG membuat secret HMAC acak, mengisi URL ingest otomatis dari
                    DG_PUBLIC_URL, dan langsung push keduanya ke NCM — tanpa mengetik URL.
                </p>
                {setupState && (
                    <div className={`mt-3 rounded-lg border p-3 text-sm ${"ok" in setupState && setupState.ok ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-red-400/20 bg-red-400/10 text-red-300"}`}>
                        {setupState.message}
                    </div>
                )}
            </form>
            <details className="mt-2">
                <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">Advanced: atur URL/secret manual</summary>
                <form action={saveAction} className="mt-2 grid gap-3 md:grid-cols-2">
                    <input type="hidden" name="ncmSiteId" value={site.siteId} />
                    <label className="space-y-1 text-sm font-medium text-slate-300">
                        URL Webhook <span className="text-xs font-normal text-slate-500">(kosong = matikan di NCM)</span>
                        <input
                            name="ncmWebhookUrl"
                            defaultValue={site.webhookUrl}
                            placeholder="https://<dg>/api/ncm/ingest"
                            className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white"
                        />
                    </label>
                    <label className="space-y-1 text-sm font-medium text-slate-300">
                        Webhook Secret <span className="text-xs font-normal text-slate-500">(kosong = biarkan tersimpan)</span>
                        <input
                            name="ncmWebhookSecret"
                            type="password"
                            autoComplete="off"
                            placeholder={site.webhookConfigured ? "Secret tersimpan; isi hanya untuk mengganti" : "HMAC secret untuk NCM"}
                            className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white"
                        />
                    </label>
                    <div className="md:col-span-2 flex justify-end">
                        <ActionButton type="submit" variant="secondary">Simpan Manual</ActionButton>
                    </div>
                </form>
                {saveState && (
                    <div className={`mt-2 rounded-lg border p-3 text-sm ${"ok" in saveState && saveState.ok ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-red-400/20 bg-red-400/10 text-red-300"}`}>
                        {saveState.message}
                    </div>
                )}
            </details>
        </div>
    );
}

function SiteRow({ site, networkDocUrl, networkDocKeySet }: { site: NcmSiteConfig; networkDocUrl: string; networkDocKeySet: boolean }) {
    const router = useRouter();
    const [saveState, saveAction, isSaving] = useActionState(saveNcmSettings, undefined);
    const [testState, testAction, isTesting] = useActionState(testNcmConnection, undefined);
    const [checkState, checkAction, isChecking] = useActionState(checkNcmNow, undefined);

    useEffect(() => {
        if (saveState?.success || testState?.ok || checkState?.ok) router.refresh();
    }, [saveState?.success, testState?.ok, checkState?.ok, router]);

    const lastSeen = formatLastSeen(site.lastSeenAt);

    return (
        <form action={saveAction} className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <input type="hidden" name="ncmSiteId" value={site.siteId} />
                <input type="hidden" name="networkDocSiteId" value={site.siteId} />
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{site.siteName}</span>
                    {site.apiKeyConfigured && (
                        <span className="inline-flex h-6 items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 text-[11px] font-medium text-emerald-300">
                            Terkonfigurasi
                        </span>
                    )}
                    {site.status === "offline" && (
                        <span className="inline-flex h-6 items-center rounded-full border border-red-400/25 bg-red-400/10 px-2 text-[11px] font-medium text-red-300">
                            OFFLINE
                        </span>
                    )}
                    {site.status === "online" && (
                        <span className="inline-flex h-6 items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 text-[11px] font-medium text-emerald-300">
                            Online
                        </span>
                    )}
                </div>
                {lastSeen && (
                    <span className="text-[11px] text-slate-400">Terakhir terlihat: {lastSeen}</span>
                )}
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm font-medium text-slate-300">
                    URL API NCM <span className="text-xs font-normal text-slate-500">(kosong = tidak aktif; dipakai NCM + Network Docs)</span>
                    <input
                        name="ncmUrl"
                        defaultValue={site.url}
                        placeholder="http://10.10.6.10:9443"
                        className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white"
                    />
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-300">
                    Admin API Key <span className="text-xs font-normal text-slate-500">(kosong = biarkan tersimpan; dipakai NCM + Network Docs)</span>
                    <input
                        name="ncmAdminApiKey"
                        type="password"
                        autoComplete="off"
                        placeholder={site.apiKeyConfigured ? "Key tersimpan; isi hanya untuk mengganti" : "Admin API key aplikasi NCM"}
                        className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white"
                    />
                </label>
            </div>

            <div className="mt-3 rounded-lg border border-slate-700/50 bg-slate-950/40 p-3">
                <div className="text-xs font-semibold text-slate-200">Network Docs Sync</div>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                    <label className="space-y-1 text-sm font-medium text-slate-300">
                        URL override <span className="text-xs font-normal text-slate-500">(kosong = pakai URL NCM di atas; isi hanya bila Network Docs beda host)</span>
                        <input
                            name="networkDocUrl"
                            defaultValue={networkDocUrl}
                            placeholder={site.url || "http://10.10.6.9:8443"}
                            className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white"
                        />
                    </label>
                    <label className="space-y-1 text-sm font-medium text-slate-300">
                        API key override <span className="text-xs font-normal text-slate-500">(kosong = pakai Admin API key di atas)</span>
                        <input
                            name="networkDocApiKey"
                            type="password"
                            autoComplete="off"
                            placeholder={networkDocKeySet ? "Key tersimpan; isi hanya untuk mengganti" : "Sama dengan Admin API key bila kosong"}
                            className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white"
                        />
                    </label>
                </div>
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
            {checkState && (
                <div className={`mt-3 rounded-lg border p-3 text-sm ${checkState.ok ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-red-400/20 bg-red-400/10 text-red-300"}`}>
                    {checkState.message}
                </div>
            )}

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <ActionButton type="submit" formAction={checkAction} variant="secondary" isPending={isChecking}>Check Now</ActionButton>
                <ActionButton type="submit" formAction={testAction} variant="secondary" isPending={isTesting}>Test Connection</ActionButton>
                <ActionButton type="submit" isPending={isSaving}>Simpan Site</ActionButton>
            </div>
        </form>
    );
}

export default function NcmSettingsForm({ initialData, networkDoc }: { initialData: NcmSettingsData; networkDoc?: NetworkDocSettingsData }) {
    const router = useRouter();
    const [intervalState, intervalAction, isIntervalPending] = useActionState(saveNetworkDocWorkerInterval, undefined);

    useEffect(() => {
        if (intervalState?.success) router.refresh();
    }, [intervalState?.success, router]);

    const networkDocBySite = new Map((networkDoc?.sites ?? []).map((s) => [s.siteId, s]));
    const customInterval = networkDoc?.workerIntervalMs != null
        && !INTERVAL_OPTIONS.some((o) => o.value === String(networkDoc.workerIntervalMs))
        ? [{ value: String(networkDoc.workerIntervalMs), label: `Custom (${Math.round((networkDoc.workerIntervalMs ?? 0) / 60_000)} menit)` }]
        : [];
    const intervalOptions = [...INTERVAL_OPTIONS, ...customInterval];

    return (
        <div className="mt-6 max-w-5xl space-y-4 rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
            <div>
                <h2 className="text-sm font-semibold text-white">NCM Connection</h2>
                <p className="mt-1 text-xs text-slate-400">
                    Satu koneksi per site ke aplikasi NCM (switch backups/reviews + Network Docs
                    sync): URL + Admin API key dipakai keduanya, tersimpan terenkripsi.
                    Tombol Test Connection memakai config site tersebut.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                    Catatan Docker: <span className="font-mono">localhost</span> dari dalam container menunjuk ke container itu
                    sendiri - pakai IP LAN host atau <span className="font-mono">http://host.docker.internal:9443</span>.
                </p>
            </div>

            <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-xs text-amber-200">
                <span className="font-semibold">Butuh scope di key NCM:</span>{" "}
                <span className="font-mono">{requiredDgScopes().join(", ")}</span>
                <br />
                Key lama (dibuat sebelum fitur scope) akan 403 &quot;API key lacks required
                scope&quot; — cek/mutakhirkan scope key di UI API Keys NCM.
            </div>

            <div className="space-y-3">
                {initialData.sites.map((site) => {
                    const doc = networkDocBySite.get(site.siteId);
                    return (
                        <div key={site.siteId} className="space-y-3">
                            <SiteRow site={site} networkDocUrl={doc?.url ?? ""} networkDocKeySet={doc?.apiKeyConfigured ?? false} />
                            <WebhookSection site={site} />
                        </div>
                    );
                })}
            </div>

            {networkDoc && (
                <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-4">
                    <form action={intervalAction} className="flex flex-wrap items-end gap-3">
                        <label className="space-y-1 text-sm font-medium text-slate-300">
                            Interval worker Network Docs (semua site)
                            <select
                                name="networkDocIntervalMs"
                                defaultValue={networkDoc.workerIntervalMs?.toString() ?? ""}
                                className="h-9 w-full min-w-44 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white"
                            >
                                {intervalOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>
                        <ActionButton type="submit" variant="secondary" isPending={isIntervalPending}>Simpan Interval</ActionButton>
                        {networkDoc.envOverridesInterval && (
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
            )}
        </div>
    );
}
