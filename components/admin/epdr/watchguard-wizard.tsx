"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronLeft, ChevronRight, CircleAlert, PlugZap, ShieldAlert } from "lucide-react";
import clsx from "clsx";
import ActionButton from "@/components/ui/action-button";
import { saveWatchGuardConnection, saveWatchGuardGlobal, testWatchGuardConnection, clearWatchGuardSecrets } from "@/actions/watchguard-settings";
import type { WatchGuardGlobalConfig, WatchGuardSettingsData, WatchGuardSiteConfig } from "@/actions/watchguard-settings";
import { EPDR_ACTION_TYPES } from "@/lib/epdr/action-types";

type ServiceTest = { ok: boolean; status: number | null; kind: string | null; message: string };
type Checks = { auth: ServiceTest; account: ServiceTest; endpointSecurity: ServiceTest; threatSync: ServiceTest };
type TestResult = { configured?: boolean; read?: Checks; write?: Checks };

function readChecks(value: unknown): Checks | null {
  const r = value as TestResult | null;
  return r?.read ?? null;
}

const REGION_LABEL: Record<string, string> = {
  jpn: "Japan (api.jpn.cloud.watchguard.com)",
  deu: "Germany (api.deu.cloud.watchguard.com)",
  usa: "United States (api.usa.cloud.watchguard.com)",
};

const SYNC_PRESETS = [
  { minutes: 15, key: "m15" },
  { minutes: 30, key: "m30" },
  { minutes: 60, key: "h1" },
] as const;

function StatusPill({ site }: { site: WatchGuardSiteConfig }) {
  const t = useTranslations("Epdr");
  if (!site.configured) return <Pill tone="muted">{t("settings.notConfigured")}</Pill>;
  if (!site.enabled) return <Pill tone="warning">{t("settings.paused")}</Pill>;
  return <Pill tone="success">{t("settings.configured")}</Pill>;
}

function Pill({ tone, children }: { tone: "muted" | "success" | "warning"; children: React.ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex h-6 items-center rounded-sm border px-2 text-[11px] font-medium",
        tone === "success" && "border-ops-success/25 bg-ops-success-soft text-ops-success",
        tone === "warning" && "border-ops-warning/25 bg-ops-warning-soft text-ops-warning",
        tone === "muted" && "border-ops-border bg-ops-surface-raised text-ops-muted",
      )}
    >
      {children}
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-ops-text">{label}</span>
      {hint && <span className="mt-0.5 block text-[12px] text-ops-muted">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

function Checklist({ checks }: { checks: Checks }) {
  const t = useTranslations("Epdr");
  const services = ["auth", "account", "endpointSecurity", "threatSync"] as const;
  return (
    <ul className="mt-3 divide-y divide-ops-border overflow-hidden rounded-md border border-ops-border">
      {services.map((s) => {
        const check = checks[s];
        return (
          <li key={s} className="flex items-center gap-3 bg-ops-surface px-3 py-2.5">
            <span
              className={clsx(
                "flex size-5 shrink-0 items-center justify-center rounded-full",
                check.ok ? "bg-ops-success-soft text-ops-success" : "bg-ops-danger-soft text-ops-danger",
              )}
              aria-hidden
            >
              {check.ok ? <Check className="size-3.5" /> : <CircleAlert className="size-3.5" />}
            </span>
            <span className="flex-1 text-[13px] text-ops-text">{t(`service.${s}`)}</span>
            <span className={clsx("text-[12.5px]", check.ok ? "text-ops-success" : "text-ops-danger")}>
              {check.ok ? "OK" : (check.kind ?? "failed")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function SiteWizard({ site, onBack }: { site: WatchGuardSiteConfig; onBack: () => void }) {
  const t = useTranslations("Epdr");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(1);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState(false);

  const checks = readChecks(site.lastTestResult);
  const allPassed = checks ? Object.values(checks).every((c) => c.ok) : false;
  const steps = [t("settings.step1"), t("settings.step2"), t("settings.step3"), t("settings.step4")];

  const formData = (extra: Record<string, string> = {}) => {
    const fd = new FormData(formRef.current!);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return fd;
  };

  const saveThenTest = () =>
    startTransition(async () => {
      setError(null);
      const saved = await saveWatchGuardConnection(null, formData({ watchguardEnabled: "" }));
      if (saved.message && !saved.success) {
        setError(saved.message);
        return;
      }
      const res = await testWatchGuardConnection(null, formData());
      if (res.message) setError(res.ok ? null : res.message);
      setTested(true);
      router.refresh();
    });

  const finish = (enabled: boolean) =>
    startTransition(async () => {
      setError(null);
      const res = await saveWatchGuardConnection(null, formData({ watchguardEnabled: enabled ? "on" : "" }));
      if (res.message && !res.success) setError(res.message);
      else {
        router.refresh();
        if (enabled) {
          setStep(5);
          return;
        }
        onBack();
      }
    });

  const clearSecrets = () =>
    startTransition(async () => {
      setError(null);
      const res = await clearWatchGuardSecrets(null, formData());
      if (res.message && !res.success) setError(res.message);
      else router.refresh();
    });

  if (step === 5) {
    return (
      <section className="ops-panel p-6">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-ops-success-soft text-ops-success">
            <Check className="size-6" aria-hidden />
          </span>
          <h2 className="text-lg font-semibold text-ops-text">{t("settings.doneTitle")}</h2>
          <p className="max-w-md text-sm text-ops-muted">{t("settings.doneBody")}</p>
          <div className="mt-2">
            <ActionButton href="/admin/epdr">{t("endpoints.title")}</ActionButton>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="ops-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ops-border px-5 py-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[13px] font-medium text-ops-muted hover:text-ops-text">
            <ChevronLeft className="size-4" aria-hidden />
            {t("settings.back")}
          </button>
          <span className="text-[15px] font-semibold text-ops-text">{site.siteName}</span>
          <StatusPill site={site} />
        </div>
      </div>

      <ol className="flex flex-wrap gap-x-1 gap-y-2 border-b border-ops-border px-5 py-3" aria-label="Progress">
        {steps.map((label, i) => {
          const index = i + 1;
          const done = index < step;
          const current = index === step;
          return (
            <li key={label} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setStep(index)}
                aria-current={current ? "step" : undefined}
                className={clsx(
                  "inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors",
                  current ? "bg-ops-accent-soft text-ops-accent" : done ? "text-ops-success" : "text-ops-muted hover:bg-ops-surface-raised",
                )}
              >
                <span
                  className={clsx(
                    "flex size-5 items-center justify-center rounded-full border text-[11px] tabular-nums",
                    current ? "border-ops-accent text-ops-accent" : done ? "border-ops-success/40 text-ops-success" : "border-ops-border-strong",
                  )}
                >
                  {done ? <Check className="size-3" aria-hidden /> : index}
                </span>
                {label}
              </button>
              {index < steps.length && <ChevronRight className="size-3.5 text-ops-subtle" aria-hidden />}
            </li>
          );
        })}
      </ol>

      {/* One form holds every field across steps so moving back and forth never loses input. */}
      <form ref={formRef} className="p-5" onSubmit={(e) => e.preventDefault()}>
        <input type="hidden" name="watchguardSiteId" value={site.siteId} />

        <div hidden={step !== 1} className="max-w-xl space-y-4">
          <Field label={t("settings.regionLabel")} hint={t("settings.regionHint")}>
            <select name="watchguardRegion" defaultValue={site.region ?? "jpn"} className="ops-input h-9 w-full px-3 text-sm">
              {Object.entries(REGION_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label={t("settings.accountLabel")} hint={t("settings.accountHint")}>
            <input name="watchguardAccountId" defaultValue={site.accountId} placeholder={t("settings.accountPlaceholder")} className="ops-input h-9 w-full px-3 font-mono text-sm" />
          </Field>
        </div>

        <div hidden={step !== 2} className="max-w-xl space-y-4">
          <div>
            <h3 className="text-[13px] font-semibold text-ops-text">{t("settings.credentialsTitle")}</h3>
            <p className="mt-0.5 text-[12px] text-ops-muted">{t("settings.credentialsBody")}</p>
          </div>
          <Field label={t("settings.apiKeyLabel")} hint={site.apiKeyConfigured ? t("settings.stored") : t("settings.apiKeyHint")}>
            <input name="watchguardApiKey" type="password" autoComplete="off" placeholder="••••••••" className="ops-input h-9 w-full px-3 font-mono text-sm" />
          </Field>
          <fieldset className="rounded-md border border-ops-border p-3.5">
            <legend className="px-1 text-[12.5px] font-medium text-ops-text">{t("settings.roTitle")}</legend>
            <p className="mb-3 text-[12px] text-ops-muted">{t("settings.roHint")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("settings.accessIdLabel")}>
                <input name="watchguardRoAccessId" defaultValue={site.roConfigured ? "********" : ""} autoComplete="off" className="ops-input h-9 w-full px-3 font-mono text-sm" />
              </Field>
              <Field label={t("settings.passwordLabel")} hint={site.roConfigured ? t("settings.stored") : undefined}>
                <input name="watchguardRoPassword" type="password" autoComplete="off" className="ops-input h-9 w-full px-3 font-mono text-sm" />
              </Field>
            </div>
          </fieldset>

          <details className="rounded-md border border-ops-border p-3.5">
            <summary className="cursor-pointer text-[12.5px] font-medium text-ops-muted">{t("settings.advanced")}</summary>
            <p className="mb-3 mt-2 text-[12px] text-ops-muted">{t("settings.rwHint")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("settings.accessIdLabel")}>
                <input name="watchguardRwAccessId" defaultValue={site.rwConfigured ? "********" : ""} autoComplete="off" className="ops-input h-9 w-full px-3 font-mono text-sm" />
              </Field>
              <Field label={t("settings.passwordLabel")} hint={site.rwConfigured ? t("settings.stored") : undefined}>
                <input name="watchguardRwPassword" type="password" autoComplete="off" className="ops-input h-9 w-full px-3 font-mono text-sm" />
              </Field>
            </div>
          </details>

          {(site.apiKeyConfigured || site.roConfigured || site.rwConfigured) && (
            <button type="button" onClick={clearSecrets} disabled={pending} className="text-[12.5px] text-ops-danger underline-offset-4 hover:underline disabled:opacity-50">
              {t("settings.clearSecrets")}
            </button>
          )}
        </div>

        <div hidden={step !== 3} className="max-w-xl space-y-4">
          <div>
            <h3 className="text-[13px] font-semibold text-ops-text">{t("settings.testHint")}</h3>
            {site.lastTestAt && (
              <p className="mt-0.5 text-[12px] text-ops-muted">
                {t("settings.lastTest")}: {new Date(site.lastTestAt).toLocaleString()}
              </p>
            )}
          </div>
          <ActionButton
            onClick={saveThenTest}
            isPending={pending}
            icon={<PlugZap />}
          >
            {pending ? t("settings.testing") : t("settings.saveAndTest")}
          </ActionButton>
          {checks && (
            <>
              <p className={clsx("text-[13px] font-medium", allPassed ? "text-ops-success" : "text-ops-warning")}>
                {allPassed ? t("settings.testPass") : t("settings.testFail")}
              </p>
              <Checklist checks={checks} />
            </>
          )}
          {tested && !checks && <p className="text-[13px] text-ops-muted">{t("settings.testHint")}</p>}
        </div>

        <div hidden={step !== 4} className="max-w-xl space-y-4">
          <div>
            <h3 className="text-[13px] font-semibold text-ops-text">{t("settings.activateTitle")}</h3>
          </div>
          <Field label={t("settings.syncLabel")} hint={t("settings.syncHint")}>
            <select name="watchguardEndpointSyncMinutes" defaultValue={String(site.endpointSyncMinutes ?? 15)} className="ops-input h-9 w-full px-3 text-sm">
              {SYNC_PRESETS.map((p) => (
                <option key={p.minutes} value={p.minutes}>{t(`settings.presets.${p.key}`)}</option>
              ))}
              {!SYNC_PRESETS.some((p) => p.minutes === site.endpointSyncMinutes) && (
                <option value={site.endpointSyncMinutes}>{t("settings.customMinutes", { n: site.endpointSyncMinutes })}</option>
              )}
            </select>
          </Field>
          <input type="hidden" name="watchguardDetectionSyncMinutes" value={site.detectionSyncMinutes ?? 5} />
          <label className="flex items-start gap-3 rounded-md border border-ops-border p-3.5">
            <input type="checkbox" name="watchguardEnabled" defaultChecked={site.enabled} className="mt-0.5 size-4" />
            <span>
              <span className="block text-[13px] font-medium text-ops-text">{t("settings.enableLabel")}</span>
              <span className="block text-[12px] text-ops-muted">{t("settings.enableHint")}</span>
            </span>
          </label>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap justify-between gap-2 border-t border-ops-border pt-4">
          <ActionButton variant="ghost" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>
            <ChevronLeft className="size-4" aria-hidden />
            {steps[Math.max(0, step - 2)]}
          </ActionButton>
          {step < 4 ? (
            <ActionButton onClick={() => setStep((s) => s + 1)}>
              {steps[step]}
              <ChevronRight className="size-4" aria-hidden />
            </ActionButton>
          ) : (
            <div className="flex gap-2">
              <ActionButton variant="secondary" isPending={pending} onClick={() => finish(false)}>
                {t("settings.saveDraft")}
              </ActionButton>
              <ActionButton isPending={pending} onClick={() => finish(true)} disabled={!allPassed}>
                {t("settings.activate")}
              </ActionButton>
            </div>
          )}
        </div>
        {step === 4 && !allPassed && <p className="mt-2 text-right text-[12px] text-ops-muted">{t("settings.testHint")}</p>}
      </form>
    </section>
  );
}

function GlobalSafeguards({ global }: { global: WatchGuardGlobalConfig }) {
  const t = useTranslations("Epdr");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <details className="ops-panel">
      <summary className="flex cursor-pointer items-center gap-3 px-5 py-4">
        <ShieldAlert className="size-4 text-ops-muted" aria-hidden />
        <span>
          <span className="text-[15px] font-semibold text-ops-text">{t("global.title")}</span>
          <span className="mt-0.5 block text-[12.5px] text-ops-muted">{t("global.description")}</span>
        </span>
        {global.killSwitch && <Pill tone="warning">{t("global.killSwitchLabel")}</Pill>}
      </summary>
      <form
        className="space-y-4 border-t border-ops-border p-5"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(async () => {
            setError(null);
            const res = await saveWatchGuardGlobal(null, fd);
            if (res.message && !res.success) setError(res.message);
            else {
              setSaved(true);
              router.refresh();
            }
          });
        }}
      >
        <label className="flex items-start gap-3 rounded-md border border-ops-warning/25 bg-ops-warning-soft/40 p-3.5">
          <input type="checkbox" name="watchguardKillSwitch" defaultChecked={global.killSwitch} className="mt-0.5 size-4" />
          <span>
            <span className="block text-[13px] font-medium text-ops-text">{t("global.killSwitchLabel")}</span>
            <span className="block text-[12px] text-ops-muted">{t("global.killSwitchHint")}</span>
          </span>
        </label>

        <fieldset>
          <legend className="text-[13px] font-medium text-ops-text">{t("global.allowedTitle")}</legend>
          <p className="mt-0.5 text-[12px] text-ops-muted">{t("global.allowedHint")}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {EPDR_ACTION_TYPES.map((a) => (
              <label key={a} className="flex items-start gap-2.5 rounded-md border border-ops-border px-3 py-2">
                <input type="checkbox" name="watchguardAllowedActions" value={a} defaultChecked={global.allowedActions.includes(a)} className="mt-0.5 size-4" />
                <span className="min-w-0">
                  <span className="block text-[13px] text-ops-text">{t(`action.${a}`)}</span>
                  <span className="block text-[11.5px] text-ops-muted">{t("global.notAvailable")}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("global.hourlyCapLabel")}>
            <input name="watchguardMaxActionsPerHour" type="number" min={1} defaultValue={global.maxActionsPerHourPerSite} className="ops-input h-9 w-full px-3 text-sm" />
          </Field>
          <Field label={t("global.simMinDaysLabel")} hint={t("global.simMinDaysHint")}>
            <input name="watchguardSimulationMinDays" type="number" min={0} defaultValue={global.simulationMinDays} className="ops-input h-9 w-full px-3 text-sm" />
          </Field>
          <Field label={t("global.autoCloseScoreLabel")}>
            <input name="watchguardAutoCloseMaxScore" type="number" min={0} max={10} defaultValue={global.autoCloseMaxScore} className="ops-input h-9 w-full px-3 text-sm" />
          </Field>
          <Field label={t("global.approvalExpiryLabel")}>
            <input name="watchguardApprovalExpiryHours" type="number" min={1} defaultValue={global.approvalExpiryHours} className="ops-input h-9 w-full px-3 text-sm" />
          </Field>
          <Field label={t("global.exclusionMaxLabel")}>
            <input name="watchguardExclusionMaxDays" type="number" min={1} max={90} defaultValue={global.exclusionMaxDays} className="ops-input h-9 w-full px-3 text-sm" />
          </Field>
        </div>

        <fieldset>
          <legend className="text-[13px] font-medium text-ops-text">{t("global.autoCloseLabel")}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["malware", "pup", "exploit", "virus", "ioa"] as const).map((c) => (
              <label key={c} className="inline-flex items-center gap-2 rounded-md border border-ops-border px-3 py-1.5">
                <input type="checkbox" name="watchguardAutoCloseCategories" value={c} defaultChecked={global.autoCloseCategories.includes(c)} className="size-4" />
                <span className="text-[13px] text-ops-text">{t(`category.${c}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && <p role="alert" className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">{error}</p>}
        {saved && !error && <p className="text-[13px] text-ops-success">{t("global.saved")}</p>}

        <div className="flex justify-end">
          <ActionButton type="submit" isPending={pending}>
            {t("global.save")}
          </ActionButton>
        </div>
      </form>
    </details>
  );
}

export default function WatchGuardWizard({ initialData }: { initialData: WatchGuardSettingsData }) {
  const t = useTranslations("Epdr");
  const [siteId, setSiteId] = useState<number | null>(null);
  const selected = siteId !== null ? initialData.sites.find((s) => s.siteId === siteId) ?? null : null;

  if (selected) {
    return (
      <div className="space-y-6">
        <SiteWizard key={selected.siteId} site={selected} onBack={() => setSiteId(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="ops-panel">
        <div className="border-b border-ops-border px-5 py-4">
          <h2 className="text-[15px] font-semibold text-ops-text">{t("settings.siteListTitle")}</h2>
          <p className="mt-0.5 text-[12.5px] text-ops-muted">{t("settings.siteListHint")}</p>
        </div>
        {initialData.sites.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ops-muted">{t("threats.empty")}</p>
        ) : (
          <ul className="divide-y divide-ops-border">
            {initialData.sites.map((site) => (
              <li key={site.siteId} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[13.5px] font-medium text-ops-text">
                    {site.siteName}
                    <StatusPill site={site} />
                  </p>
                  <p className="mt-0.5 text-[12px] text-ops-muted">
                    {site.accountId ? <span className="font-mono">{site.accountId}</span> : t("settings.accountPlaceholder")}
                    {" · "}
                    {t("settings.lastTest")}: {site.lastTestAt ? new Date(site.lastTestAt).toLocaleString() : t("settings.never")}
                  </p>
                </div>
                <ActionButton variant={site.configured ? "secondary" : "primary"} onClick={() => setSiteId(site.siteId)}>
                  {site.configured ? t("settings.manage") : t("settings.setup")}
                </ActionButton>
              </li>
            ))}
          </ul>
        )}
      </section>

      <GlobalSafeguards global={initialData.global} />
    </div>
  );
}
