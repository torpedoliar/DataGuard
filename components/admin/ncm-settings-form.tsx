"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { checkNcmNow, saveNcmSettings, saveNcmWebhook, setupNcmWebhook, testNcmConnection } from "@/actions/ncm-settings";
import { saveNetworkDocWorkerInterval } from "@/actions/network-doc-settings";
import type { NcmSettingsData, NcmSiteConfig } from "@/actions/ncm-settings";
import type { NetworkDocSettingsData } from "@/actions/network-doc-settings";
import ActionButton from "@/components/ui/action-button";
import { requiredDgScopes } from "@/lib/ncm-setup";
import { RefreshCw } from "lucide-react";

function formatLastSeen(value: Date | null): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString();
}

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
        <div className="mt-3 rounded-lg border border-ops-border/50 bg-ops-surface/40 p-4">
            <form action={setupAction}>
                <input type="hidden" name="ncmSiteId" value={site.siteId} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">Webhook NCM → DG ({site.siteName})</span>
                        {site.webhookConfigured ? (
                            <span className="inline-flex h-6 items-center rounded-full border border-ops-success/25 bg-ops-success-soft px-2 text-[11px] font-medium text-ops-success">
                                Webhook terkonfigurasi
                            </span>
                        ) : (
                            <span className="inline-flex h-6 items-center rounded-full border border-ops-warning/25 bg-ops-warning-soft px-2 text-[11px] font-medium text-ops-warning">
                                Webhook belum dikonfigurasi
                            </span>
                        )}
                    </div>
                    <ActionButton type="submit" isPending={isSettingUp}>Aktifkan Webhook (1 klik)</ActionButton>
                </div>
                <p className="mt-1 text-xs text-ops-muted">
                    DG membuat secret HMAC acak, mengisi URL ingest otomatis dari
                    DG_PUBLIC_URL / host aktif, dan langsung push keduanya ke NCM — tanpa mengetik URL.
                </p>
                {setupState && (
                    <div className={`mt-3 rounded-lg border p-3 text-sm ${"ok" in setupState && setupState.ok ? "border-ops-success/20 bg-ops-success-soft text-ops-success" : "border-ops-danger/20 bg-ops-danger-soft text-ops-danger"}`}>
                        {setupState.message}
                    </div>
                )}
            </form>
            <details className="mt-2">
                <summary className="cursor-pointer text-xs text-ops-subtle hover:text-ops-muted">Advanced: atur URL/secret manual</summary>
                <form action={saveAction} className="mt-2 grid gap-3 md:grid-cols-2">
                    <input type="hidden" name="ncmSiteId" value={site.siteId} />
                    <label className="space-y-1 text-sm font-medium text-ops-muted">
                        URL Webhook <span className="text-xs font-normal text-ops-subtle">(kosong = matikan di NCM)</span>
                        <input
                            name="ncmWebhookUrl"
                            defaultValue={site.webhookUrl}
                            placeholder="https://<dg>/api/ncm/ingest"
                            className="h-9 w-full rounded-lg border border-ops-border bg-ops-surface px-3 font-mono text-sm text-white"
                        />
                    </label>
                    <label className="space-y-1 text-sm font-medium text-ops-muted">
                        Webhook Secret <span className="text-xs font-normal text-ops-subtle">(kosong = biarkan tersimpan)</span>
                        <input
                            name="ncmWebhookSecret"
                            type="password"
                            autoComplete="off"
                            placeholder={site.webhookConfigured ? "Secret tersimpan; isi hanya untuk mengganti" : "HMAC secret untuk NCM"}
                            className="h-9 w-full rounded-lg border border-ops-border bg-ops-surface px-3 font-mono text-sm text-white"
                        />
                    </label>
                    <div className="md:col-span-2 flex justify-end">
                        <ActionButton type="submit" variant="secondary">Simpan Manual</ActionButton>
                    </div>
                </form>
                {saveState && (
                    <div className={`mt-2 rounded-lg border p-3 text-sm ${"ok" in saveState && saveState.ok ? "border-ops-success/20 bg-ops-success-soft text-ops-success" : "border-ops-danger/20 bg-ops-danger-soft text-ops-danger"}`}>
                        {saveState.message}
                    </div>
                )}
            </details>
        </div>
    );
}

function SiteCard({
    site,
    networkDocUrl,
    networkDocKeySet,
}: {
    site: NcmSiteConfig;
    networkDocUrl: string;
    networkDocKeySet: boolean;
}) {
    const router = useRouter();
    const [saveState, saveAction, isSaving] = useActionState(saveNcmSettings, undefined);
    const [testState, testAction, isTesting] = useActionState(testNcmConnection, undefined);
    const [checkState, checkAction, isChecking] = useActionState(checkNcmNow, undefined);

    useEffect(() => {
        if (saveState?.success || testState?.ok || checkState?.ok) router.refresh();
    }, [saveState?.success, testState?.ok, checkState?.ok, router]);

    const lastSeen = formatLastSeen(site.lastSeenAt);

    return (
        <div className="rounded-xl border border-ops-border/60 bg-ops-surface/60 p-5 space-y-4">
            {/* Header Site */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ops-border/40 pb-3">
                <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-white">{site.siteName}</span>
                    {site.apiKeyConfigured && (
                        <span className="inline-flex h-6 items-center rounded-full border border-ops-success/25 bg-ops-success-soft px-2 text-[11px] font-medium text-ops-success">
                            Terkonfigurasi
                        </span>
                    )}
                    {site.status === "offline" && (
                        <span className="inline-flex h-6 items-center rounded-full border border-ops-danger/25 bg-ops-danger-soft px-2 text-[11px] font-medium text-ops-danger">
                            OFFLINE
                        </span>
                    )}
                    {site.status === "online" && (
                        <span className="inline-flex h-6 items-center rounded-full border border-ops-success/25 bg-ops-success-soft px-2 text-[11px] font-medium text-ops-success">
                            Online
                        </span>
                    )}
                    {site.webhookConfigured && (
                        <span className="inline-flex h-6 items-center rounded-full border border-ops-info/25 bg-ops-info-soft px-2 text-[11px] font-medium text-ops-info">
                            Webhook Aktif
                        </span>
                    )}
                </div>
                {lastSeen && (
                    <span className="text-[11px] text-ops-muted">Terakhir terlihat: {lastSeen}</span>
                )}
            </div>

            {/* Form Koneksi Terpadu (NCM + Network Docs) */}
            <form action={saveAction} className="space-y-4">
                <input type="hidden" name="ncmSiteId" value={site.siteId} />
                <input type="hidden" name="networkDocSiteId" value={site.siteId} />

                <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1 text-sm font-medium text-ops-muted">
                        URL API NCM &amp; Network Docs <span className="text-xs font-normal text-ops-subtle">(kosong = tidak aktif; dipakai NCM fleet + Network Docs sync)</span>
                        <input
                            name="ncmUrl"
                            defaultValue={site.url || networkDocUrl}
                            placeholder="http://192.168.2.3:8443"
                            className="h-9 w-full rounded-lg border border-ops-border bg-ops-surface px-3 font-mono text-sm text-white"
                        />
                    </label>
                    <label className="space-y-1 text-sm font-medium text-ops-muted">
                        Admin API Key <span className="text-xs font-normal text-ops-subtle">(kosong = biarkan tersimpan; dipakai NCM + Network Docs)</span>
                        <input
                            name="ncmAdminApiKey"
                            type="password"
                            autoComplete="off"
                            placeholder={site.apiKeyConfigured || networkDocKeySet ? "Key tersimpan; isi hanya untuk mengganti" : "Admin API key aplikasi NCM"}
                            className="h-9 w-full rounded-lg border border-ops-border bg-ops-surface px-3 font-mono text-sm text-white"
                        />
                    </label>
                </div>

                <div className="flex items-center gap-2 text-xs text-ops-muted">
                    <RefreshCw className="size-4 text-ops-subtle" />
                    <span>Satu form terpadu: URL &amp; API key di atas otomatis digunakan untuk <strong>NCM Fleet Management</strong> dan sinkronisasi <strong>Network Docs Sync</strong>.</span>
                </div>

                {saveState?.errors && (
                    <div className="rounded-lg border border-ops-danger/20 bg-ops-danger-soft p-3 text-sm text-ops-danger">
                        {Object.values(saveState.errors as Record<string, string[]>).flat().join(" ")}
                    </div>
                )}
                {saveState?.message && !saveState.success && (
                    <div className="rounded-lg border border-ops-danger/20 bg-ops-danger-soft p-3 text-sm text-ops-danger">{saveState.message}</div>
                )}
                {testState && (
                    <div className={`rounded-lg border p-3 text-sm ${testState.ok ? "border-ops-success/20 bg-ops-success-soft text-ops-success" : "border-ops-danger/20 bg-ops-danger-soft text-ops-danger"}`}>
                        {testState.message}
                    </div>
                )}
                {checkState && (
                    <div className={`rounded-lg border p-3 text-sm ${checkState.ok ? "border-ops-success/20 bg-ops-success-soft text-ops-success" : "border-ops-danger/20 bg-ops-danger-soft text-ops-danger"}`}>
                        {checkState.message}
                    </div>
                )}

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end pt-2">
                    <ActionButton type="submit" formAction={checkAction} variant="secondary" isPending={isChecking}>Check Now</ActionButton>
                    <ActionButton type="submit" formAction={testAction} variant="secondary" isPending={isTesting}>Test Connection</ActionButton>
                    <ActionButton type="submit" isPending={isSaving}>Simpan Site</ActionButton>
                </div>
            </form>

            {/* Webhook Section Khusus Site Ini */}
            <WebhookSection site={site} />
        </div>
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
        <div className="mt-6 max-w-5xl space-y-5 rounded-2xl border border-ops-border/50 bg-ops-surface-raised/40 p-6">
            <div>
                <h2 className="text-sm font-semibold text-white">NCM Connection</h2>
                <p className="mt-1 text-xs text-ops-muted">
                    Satu konfigurasi terpadu per site ke aplikasi NCM (switch backups, drift reviews, dan Network Docs
                    sync). URL + Admin API key digunakan bersama untuk kedua fitur tersebut dan tersimpan aman terenkripsi.
                </p>
                <p className="mt-1 text-xs text-ops-subtle">
                    Catatan Docker: <span className="font-mono">localhost</span> dari dalam container menunjuk ke container itu
                    sendiri - pakai IP LAN host atau <span className="font-mono">http://host.docker.internal:9443</span>.
                </p>
            </div>

            <div className="rounded-lg border border-ops-warning/25 bg-ops-warning-soft p-3 text-xs text-ops-warning">
                <span className="font-semibold">Butuh scope di key NCM:</span>{" "}
                <span className="font-mono">{requiredDgScopes().join(", ")}</span>
                <br />
                Key lama (dibuat sebelum fitur scope) akan 403 &quot;API key lacks required
                scope&quot; — cek/mutakhirkan scope key di UI API Keys NCM.
            </div>

            <div className="space-y-4">
                {initialData.sites.map((site) => {
                    const doc = networkDocBySite.get(site.siteId);
                    return (
                        <SiteCard
                            key={site.siteId}
                            site={site}
                            networkDocUrl={doc?.url ?? ""}
                            networkDocKeySet={doc?.apiKeyConfigured ?? false}
                        />
                    );
                })}
            </div>

            {networkDoc && (
                <div className="rounded-lg border border-ops-border/50 bg-ops-surface/40 p-4">
                    <form action={intervalAction} className="flex flex-wrap items-end gap-3">
                        <label className="space-y-1 text-sm font-medium text-ops-muted">
                            Interval worker Network Docs (semua site)
                            <select
                                name="networkDocIntervalMs"
                                defaultValue={networkDoc.workerIntervalMs?.toString() ?? ""}
                                className="h-9 w-full min-w-44 rounded-lg border border-ops-border bg-ops-surface px-3 text-sm text-white"
                            >
                                {intervalOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>
                        <ActionButton type="submit" variant="secondary" isPending={isIntervalPending}>Simpan Interval</ActionButton>
                        {networkDoc.envOverridesInterval && (
                            <span className="text-xs text-ops-warning">Env NETWORK_DOC_SYNC_INTERVAL_MS menang bila diisi.</span>
                        )}
                    </form>
                    {intervalState?.message && !intervalState.success && (
                        <div className="mt-2 rounded-lg border border-ops-danger/20 bg-ops-danger-soft p-2 text-sm text-ops-danger">{intervalState.message}</div>
                    )}
                    {intervalState?.success && (
                        <div className="mt-2 rounded-lg border border-ops-success/20 bg-ops-success-soft p-2 text-sm text-ops-success">Interval disimpan.</div>
                    )}
                </div>
            )}
        </div>
    );
}
