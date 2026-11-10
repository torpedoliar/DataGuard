"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import {
  clearWatchGuardSecrets,
  saveWatchGuardConnection,
  saveWatchGuardGlobal,
  testWatchGuardConnection,
} from "@/actions/watchguard-settings";
import type { WatchGuardGlobalConfig, WatchGuardSettingsData, WatchGuardSiteConfig } from "@/actions/watchguard-settings";
import { EPDR_ACTION_TYPES } from "@/lib/epdr/action-types";
import ActionButton from "@/components/ui/action-button";
import { ShieldAlert } from "lucide-react";

type ServiceBadge = { ok: boolean; status: number | null; kind: string | null; message: string };
type Checks = { auth: ServiceBadge; account: ServiceBadge; endpointSecurity: ServiceBadge; threatSync: ServiceBadge };

function toChecks(value: unknown): Checks | null {
  const obj = value as { read?: Checks } | null;
  return obj?.read ?? null;
}

const REGION_OPTIONS = [
  { value: "jpn", label: "Jepang (api.jpn.cloud.watchguard.com)" },
  { value: "deu", label: "Jerman (api.deu.cloud.watchguard.com)" },
  { value: "usa", label: "AS (api.usa.cloud.watchguard.com)" },
];

function ServiceBadges({ checks }: { checks: Checks | null }) {
  if (!checks) return null;
  const services = [
    ["Auth", checks.auth],
    ["Account", checks.account],
    ["Endpoint Security", checks.endpointSecurity],
    ["ThreatSync", checks.threatSync],
  ] as const;
  return (
    <div className="flex flex-wrap gap-2">
      {services.map(([label, s]) => (
        <span
          key={label}
          className={`inline-flex h-6 items-center rounded-sm border px-2 text-[11px] font-medium ${
            s.ok ? "border-ops-success/25 bg-ops-success-soft text-ops-success" : "border-ops-danger/25 bg-ops-danger-soft text-ops-danger"
          }`}
        >
          {label}: {s.ok ? "OK" : (s.kind ?? "gagal")}
        </span>
      ))}
    </div>
  );
}

function SiteCard({ site }: { site: WatchGuardSiteConfig }) {
  const router = useRouter();
  const [saveState, saveAction, isSaving] = useActionState(saveWatchGuardConnection, undefined);
  const [testState, testAction, isTesting] = useActionState(testWatchGuardConnection, undefined);
  const [clearState, clearAction, isClearing] = useActionState(clearWatchGuardSecrets, undefined);

  useEffect(() => {
    if (saveState?.success || testState?.ok || clearState?.success) router.refresh();
  }, [saveState?.success, testState?.ok, clearState?.success, router]);

  const checks = toChecks(site.lastTestResult);

  return (
    <div className="ops-panel space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ops-border pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">{site.siteName}</span>
          {site.configured && (
            <span className="inline-flex h-6 items-center rounded-sm border border-ops-success/25 bg-ops-success-soft px-2 text-[11px] font-medium text-ops-success">
              Terkonfigurasi
            </span>
          )}
        </div>
        {site.lastTestAt && <span className="text-[11px] text-ops-muted">Tes terakhir: {new Date(site.lastTestAt).toLocaleString()}</span>}
      </div>

      <form action={saveAction} className="space-y-4">
        <input type="hidden" name="watchguardSiteId" value={site.siteId} />

        <label className="flex items-center gap-2 text-[13px] font-medium text-ops-muted">
          <input type="checkbox" name="watchguardEnabled" defaultChecked={site.enabled} className="size-4" />
          Aktifkan koneksi (background sync/jobs berjalan hanya bila aktif)
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            Region
            <select name="watchguardRegion" defaultValue={site.region ?? "jpn"} className="ops-input h-9 w-full px-3 text-sm">
              {REGION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            Account ID
            <input name="watchguardAccountId" defaultValue={site.accountId} placeholder="WGC-3-…" className="ops-input h-9 w-full px-3 font-mono text-sm" />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            API key <span className="text-xs font-normal text-ops-subtle">(kosong = biarkan tersimpan)</span>
            <input name="watchguardApiKey" type="password" autoComplete="off" placeholder={site.apiKeyConfigured ? "Tersimpan; isi hanya untuk mengganti" : "WatchGuard-API-Key"} className="ops-input h-9 w-full px-3 font-mono text-sm" />
          </label>
          <div />
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            RW Access ID
            <input name="watchguardRwAccessId" defaultValue={site.rwConfigured ? site.accountId : ""} placeholder="Access ID read-write" className="ops-input h-9 w-full px-3 font-mono text-sm" />
          </label>
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            RW Password <span className="text-xs font-normal text-ops-subtle">(kosong = biarkan tersimpan)</span>
            <input name="watchguardRwPassword" type="password" autoComplete="off" placeholder={site.rwConfigured ? "Tersimpan" : "Password read-write"} className="ops-input h-9 w-full px-3 font-mono text-sm" />
          </label>
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            RO Access ID
            <input name="watchguardRoAccessId" defaultValue="" placeholder="Access ID read-only" className="ops-input h-9 w-full px-3 font-mono text-sm" />
          </label>
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            RO Password <span className="text-xs font-normal text-ops-subtle">(kosong = biarkan tersimpan)</span>
            <input name="watchguardRoPassword" type="password" autoComplete="off" placeholder={site.roConfigured ? "Tersimpan" : "Password read-only"} className="ops-input h-9 w-full px-3 font-mono text-sm" />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            Interval endpoint (menit, 5–1440)
            <input name="watchguardEndpointSyncMinutes" type="number" min={5} max={1440} defaultValue={site.endpointSyncMinutes ?? 15} className="ops-input h-9 w-full px-3 text-sm" />
          </label>
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            Interval deteksi (menit, 2–60)
            <input name="watchguardDetectionSyncMinutes" type="number" min={2} max={60} defaultValue={site.detectionSyncMinutes ?? 5} className="ops-input h-9 w-full px-3 text-sm" />
          </label>
        </div>

        {(saveState?.message && !saveState.success) && (
          <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">{saveState.message}</div>
        )}
        {testState && (
          <div className={`rounded-md border px-3 py-2.5 text-[13px] ${testState.ok ? "border-ops-success/25 bg-ops-success-soft text-ops-success" : "border-ops-danger/25 bg-ops-danger-soft text-ops-danger"}`}>
            {testState.message}
          </div>
        )}
        {clearState && (
          <div className={`rounded-md border px-3 py-2.5 text-[13px] ${clearState.success ? "border-ops-success/25 bg-ops-success-soft text-ops-success" : "border-ops-danger/25 bg-ops-danger-soft text-ops-danger"}`}>
            {clearState.message}
          </div>
        )}

        <div className="font-mono text-[11px] text-ops-subtle">
          rev kredensial: {site.credentialRevision} · rev akun: {site.accountRevision}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end pt-2">
          <ServiceBadges checks={checks} />
          <div className="flex gap-2">
            <ActionButton type="submit" formAction={testAction} variant="secondary" isPending={isTesting}>Tes Koneksi</ActionButton>
            <ActionButton type="submit" formAction={clearAction} variant="secondary" isPending={isClearing}>Hapus Secret</ActionButton>
            <ActionButton type="submit" isPending={isSaving}>Simpan Koneksi</ActionButton>
          </div>
        </div>
      </form>
    </div>
  );
}

function GlobalSection({ global }: { global: WatchGuardGlobalConfig }) {
  const router = useRouter();
  const [state, action, isPending] = useActionState(saveWatchGuardGlobal, undefined);

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  return (
    <div className="ops-panel mt-2 space-y-4 p-5">
      <form action={action} className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Global WatchGuard controls</h2>
            <p className="mt-1 text-[13px] text-ops-muted">Kill switch global, daftar aksi yang boleh diaktifkan site, dan batas global.</p>
          </div>
          {global.killSwitch && (
            <span className="inline-flex items-center gap-2 rounded-md border border-ops-danger/30 bg-ops-danger px-3 py-2 text-[13px] font-semibold text-white">
              <ShieldAlert className="size-4" /> KILL SWITCH AKTIF
            </span>
          )}
        </div>

        <label className="flex items-center gap-2 text-[13px] font-medium text-ops-muted">
          <input type="checkbox" name="watchguardKillSwitch" defaultChecked={global.killSwitch} className="size-4" />
          Kill switch global (blokir semua tulis provider)
        </label>

        <div>
          <div className="text-[13px] font-medium text-ops-muted">Aksi yang diizinkan (ceiling semua site)</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {EPDR_ACTION_TYPES.map((a) => (
              <label key={a} className="flex items-center gap-2 text-[13px] text-ops-muted">
                <input type="checkbox" name="watchguardAllowedActions" value={a} defaultChecked={global.allowedActions.includes(a)} className="size-4" />
                <span className="font-mono">{a}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            Batas aksi per jam per site
            <input name="watchguardMaxActionsPerHour" type="number" min={1} defaultValue={global.maxActionsPerHourPerSite} className="ops-input h-9 w-full px-3 text-sm" />
          </label>
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            Minimal hari simulasi (aktivasi otomatis)
            <input name="watchguardSimulationMinDays" type="number" min={0} defaultValue={global.simulationMinDays} className="ops-input h-9 w-full px-3 text-sm" />
          </label>
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            Kategori auto-close (pisahkan dengan koma)
            <input name="watchguardAutoCloseCategories" defaultValue={global.autoCloseCategories.join(",")} className="ops-input h-9 w-full px-3 font-mono text-sm" />
          </label>
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            Skor maksimal auto-close (0–10)
            <input name="watchguardAutoCloseMaxScore" type="number" min={0} max={10} defaultValue={global.autoCloseMaxScore} className="ops-input h-9 w-full px-3 text-sm" />
          </label>
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            Kedaluwarsa approval (jam)
            <input name="watchguardApprovalExpiryHours" type="number" min={1} defaultValue={global.approvalExpiryHours} className="ops-input h-9 w-full px-3 text-sm" />
          </label>
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            Kedaluwarsa exclusion maks (hari, ≤90)
            <input name="watchguardExclusionMaxDays" type="number" min={1} max={90} defaultValue={global.exclusionMaxDays} className="ops-input h-9 w-full px-3 text-sm" />
          </label>
        </div>

        {state?.message && !state.success && (
          <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">{state.message}</div>
        )}

        <div className="flex justify-end">
          <ActionButton type="submit" isPending={isPending}>Simpan Global</ActionButton>
        </div>
      </form>
    </div>
  );
}

export default function WatchGuardSettingsForm({ initialData }: { initialData: WatchGuardSettingsData }) {
  return (
    <div className="ops-panel mt-6 max-w-5xl space-y-5 p-5">
      <div>
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">WatchGuard EPDR</h2>
        <p className="mt-1 text-[13px] text-ops-muted">
          Koneksi per site dan kontrol global. Mode saat ini <strong>READ-ONLY</strong>: semua aksi tulis diblokir sebelum network.
        </p>
      </div>

      <GlobalSection global={initialData.global} />

      <div className="space-y-4">
        {initialData.sites.map((site) => (
          <SiteCard key={site.siteId} site={site} />
        ))}
      </div>
    </div>
  );
}