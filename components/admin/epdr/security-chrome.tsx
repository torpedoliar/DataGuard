import { getTranslations } from "next-intl/server";
import { AlertTriangle, Eye, PauseCircle, PlugZap, RefreshCw } from "lucide-react";
import clsx from "clsx";
import ActionButton from "@/components/ui/action-button";
import type { EpdrSecurityContext } from "@/actions/epdr-endpoints";
import type { ConnectionState } from "@/lib/epdr/posture";

const SETTINGS_HREF = "/admin/settings/watchguard";

const toneByState: Record<ConnectionState, string> = {
  live: "bg-ops-success",
  stale: "bg-ops-warning",
  error: "bg-ops-danger",
  syncing_first: "bg-ops-info",
  disabled: "bg-ops-subtle",
  not_configured: "bg-ops-subtle",
};

function relativeTime(date: Date, locale: string): string {
  const diffSec = Math.round((date.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86400), "day");
}

/** Live/stale pill + read-only badge shown in every Security page header. */
export async function SecurityStatusPills({ context, locale }: { context: EpdrSecurityContext; locale: string }) {
  const t = await getTranslations("Epdr");
  const live = context.connection === "live";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex h-7 items-center gap-2 rounded-md border border-ops-border bg-ops-surface px-2.5 text-[12px] font-medium text-ops-text">
        <span className="relative flex size-2">
          {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-ops-success opacity-50 motion-reduce:hidden" />}
          <span className={clsx("relative inline-flex size-2 rounded-full", toneByState[context.connection])} />
        </span>
        {t(`connection.${context.connection}`)}
        {context.lastSyncAt && (
          <span className="font-normal text-ops-muted">· {t("updated", { time: relativeTime(context.lastSyncAt, locale) })}</span>
        )}
      </span>
      <span
        title={t("readOnlyHint")}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-ops-info/25 bg-ops-info-soft px-2.5 text-[12px] font-medium text-ops-info"
      >
        <Eye className="size-3.5" aria-hidden />
        {t("readOnly")}
      </span>
    </div>
  );
}

/**
 * Explains why a Security page has no data and what to do next. Returns null
 * when the connection is live (the page renders its data instead).
 */
export async function ConnectionGate({ context }: { context: EpdrSecurityContext }) {
  const t = await getTranslations("Epdr");
  const state = context.connection;

  if (state === "not_configured") {
    const steps = t("setup.steps").split("|");
    return (
      <section className="ops-panel overflow-hidden">
        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-center">
          <div className="max-w-xl">
            <div className="mb-4 flex size-10 items-center justify-center rounded-lg border border-ops-border bg-ops-surface-raised text-ops-accent">
              <PlugZap className="size-5" aria-hidden />
            </div>
            <h2 className="text-lg font-semibold tracking-[-0.015em] text-ops-text">{t("setup.title", { site: context.siteName })}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ops-muted">{t("setup.body")}</p>
            <div className="mt-5">
              {context.isSuperadmin ? (
                <ActionButton href={SETTINGS_HREF} icon={<PlugZap />}>{t("setup.cta")}</ActionButton>
              ) : (
                <p className="text-sm text-ops-text">{t("setup.askAdmin")}</p>
              )}
            </div>
          </div>
          <ol className="space-y-3">
            {steps.map((step, i) => (
              <li key={step} className="flex items-center gap-3 rounded-md border border-ops-border bg-ops-surface-raised/60 px-3 py-2.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-ops-border-strong text-[12px] font-semibold tabular-nums text-ops-muted">{i + 1}</span>
                <span className="text-sm text-ops-text">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    );
  }

  if (state === "disabled") {
    return (
      <GateBanner tone="neutral" icon={<PauseCircle />} title={t("setup.disabledTitle")} body={t("setup.disabledBody")}
        action={context.isSuperadmin ? <ActionButton href={SETTINGS_HREF} variant="secondary" size="sm">{t("setup.resume")}</ActionButton> : null} />
    );
  }

  if (state === "syncing_first") {
    return <GateBanner tone="info" icon={<RefreshCw />} title={t("setup.firstSyncTitle")} body={t("setup.firstSyncBody")}
      action={context.isSuperadmin ? <ActionButton href={SETTINGS_HREF} variant="secondary" size="sm">{t("setup.fix")}</ActionButton> : null} />;
  }

  return null;
}

/** Inline warning shown above live data when the data is stale or the last sync failed. */
export async function FreshnessWarning({ context, locale }: { context: EpdrSecurityContext; locale: string }) {
  const t = await getTranslations("Epdr");
  if (context.connection !== "stale" && context.connection !== "error") return null;
  const isError = context.connection === "error";
  return (
    <GateBanner
      tone={isError ? "danger" : "warning"}
      icon={<AlertTriangle />}
      title={isError ? t("setup.errorTitle") : t("connection.stale")}
      body={isError ? t("setup.errorBody") : t("setup.staleBody", { time: context.lastSyncAt ? relativeTime(context.lastSyncAt, locale) : t("never") })}
      action={context.isSuperadmin ? <ActionButton href={SETTINGS_HREF} variant="secondary" size="sm">{t("setup.fix")}</ActionButton> : null}
    />
  );
}

const bannerTone = {
  neutral: "border-ops-border bg-ops-surface text-ops-muted",
  info: "border-ops-info/25 bg-ops-info-soft text-ops-info",
  warning: "border-ops-warning/25 bg-ops-warning-soft text-ops-warning",
  danger: "border-ops-danger/25 bg-ops-danger-soft text-ops-danger",
} as const;

function GateBanner({ tone, icon, title, body, action }: { tone: keyof typeof bannerTone; icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div role="status" className={clsx("flex flex-col gap-3 rounded-lg border px-4 py-3.5 sm:flex-row sm:items-center", bannerTone[tone])}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 [&_svg]:size-4" aria-hidden>{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ops-text">{title}</p>
          <p className="mt-0.5 text-[13px] text-ops-muted">{body}</p>
        </div>
      </div>
      {action}
    </div>
  );
}
