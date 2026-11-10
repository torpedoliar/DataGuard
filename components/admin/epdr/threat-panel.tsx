"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, ShieldQuestion } from "lucide-react";
import clsx from "clsx";
import type { EpdrDetectionRow, EpdrThreatsData } from "@/actions/epdr-threats";
import { THREAT_CATEGORIES, type ThreatCategory, type TrendDay } from "@/lib/epdr/posture";

/** One severity-ordered palette for the whole page: bars, dots and list rows agree. */
const CATEGORY_FILL: Record<string, string> = {
  malware: "bg-ops-danger",
  virus: "bg-ops-orange",
  exploit: "bg-ops-warning",
  ioa: "bg-ops-info",
  pup: "bg-ops-muted",
};
const CATEGORY_TEXT: Record<string, string> = {
  malware: "text-ops-danger",
  virus: "text-ops-orange",
  exploit: "text-ops-warning",
  ioa: "text-ops-info",
  pup: "text-ops-muted",
};

const SEVERITY_BADGE: Record<string, string> = {
  Critical: "border-ops-danger/30 bg-ops-danger-soft text-ops-danger",
  High: "border-ops-orange/30 bg-ops-orange-soft text-ops-orange",
  Medium: "border-ops-warning/30 bg-ops-warning-soft text-ops-warning",
  Low: "border-ops-border bg-ops-surface-raised text-ops-muted",
};

function relative(date: Date, locale: string): string {
  const diffSec = Math.round((new Date(date).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86400), "day");
}

function Trend({ trend, locale }: { trend: TrendDay[]; locale: string }) {
  const t = useTranslations("Epdr");
  const max = Math.max(...trend.map((d) => d.total), 1);
  const active = useMemo(() => trend.filter((d) => d.total > 0), [trend]);

  if (active.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-ops-border text-[13px] text-ops-muted">
        {t("threats.trendEmpty")}
      </div>
    );
  }

  return (
    <div>
      <div className="flex h-32 items-end gap-[3px]" role="img" aria-label={t("threats.trend")}>
        {trend.map((day) => {
          const dayLabel = new Date(`${day.date}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
          return (
            <div key={day.date} className="group relative flex h-full flex-1 flex-col justify-end">
              {day.total > 0 ? (
                <div className="flex flex-col-reverse overflow-hidden rounded-[2px]" style={{ height: `${(day.total / max) * 100}%` }}>
                  {THREAT_CATEGORIES.map((c) =>
                    day.counts[c] > 0 ? (
                      <div key={c} className={clsx(CATEGORY_FILL[c], "w-full")} style={{ height: `${(day.counts[c] / day.total) * 100}%` }} />
                    ) : null,
                  )}
                </div>
              ) : (
                <div className="h-[2px] w-full rounded-full bg-ops-border" />
              )}
              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-ops-border bg-ops-surface px-2.5 py-1.5 text-[12px] text-ops-text opacity-0 shadow-[var(--shadow-overlay)] transition-opacity group-hover:opacity-100">
                <span className="font-medium tabular-nums">{dayLabel}</span>
                {day.total === 0 ? (
                  <span className="block text-ops-muted">—</span>
                ) : (
                  THREAT_CATEGORIES.filter((c) => day.counts[c] > 0).map((c) => (
                    <span key={c} className="block text-ops-muted">
                      {t(`category.${c}`)} <span className="font-medium text-ops-text tabular-nums">{day.counts[c]}</span>
                    </span>
                  ))
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11.5px] tabular-nums text-ops-subtle">
        <span>{new Date(`${trend[0]!.date}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" })}</span>
        <span>{new Date(`${trend[trend.length - 1]!.date}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" })}</span>
      </div>
    </div>
  );
}

function DetectionRow({ d, locale }: { d: EpdrDetectionRow; locale: string }) {
  const t = useTranslations("Epdr");
  const active = d.incidentStatus === "Open" || d.incidentStatus === "In Progress";
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <span className={clsx("size-2 shrink-0 rounded-full", CATEGORY_FILL[d.category] ?? CATEGORY_FILL.pup)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] text-ops-text">
          {t("threats.found", { category: t(`category.${d.category}`), host: d.hostName ?? t("threats.unknownHost") })}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ops-muted">
          <span>{t(`threats.source.${d.source}`)}</span>
          {d.threatScore !== null && <span className="tabular-nums">· {t("threats.score", { score: d.threatScore })}</span>}
          <span>· {relative(d.detectedAt, locale)}</span>
        </p>
      </div>
      <span className={clsx("hidden shrink-0 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium sm:inline-block", SEVERITY_BADGE[d.severity] ?? SEVERITY_BADGE.Low)}>
        {t(`severity.${d.severity}`)}
      </span>
      {d.incidentId && active ? (
        <Link href={`/admin/incidents/${d.incidentId}`} className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-ops-accent underline-offset-4 hover:underline">
          {t("threats.openIncident")}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      ) : (
        <span className="shrink-0 text-[12.5px] text-ops-subtle">{t("threats.noIncident")}</span>
      )}
    </li>
  );
}

export default function ThreatPanel({ data, locale }: { data: EpdrThreatsData; locale: string }) {
  const t = useTranslations("Epdr");
  const [showIgnored, setShowIgnored] = useState(false);
  const cleared = data.activeCount === 0;

  return (
    <>
      {/* Status: the one sentence a shift technician needs. */}
      <section
        role="status"
        className={clsx(
          "flex flex-col gap-2 rounded-lg border px-5 py-4 sm:flex-row sm:items-center sm:justify-between",
          cleared ? "border-ops-success/25 bg-ops-success-soft" : "border-ops-orange/25 bg-ops-orange-soft",
        )}
      >
        <div className="flex items-start gap-3">
          {cleared ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ops-success" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-ops-orange" aria-hidden />
          )}
          <div>
            <p className={clsx("text-[15px] font-semibold", cleared ? "text-ops-success" : "text-ops-orange")}>
              {cleared ? t("threats.clear") : t("threats.active", { count: data.activeCount })}
            </p>
            <p className="mt-0.5 text-[13px] text-ops-muted">{cleared ? t("threats.clearBody") : t("threats.activeBody")}</p>
          </div>
        </div>
      </section>

      {/* Category panels: what it is, how much of it, in plain words. */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {THREAT_CATEGORIES.map((c: ThreatCategory) => {
          const totals = data.categoryTotals[c];
          const quiet = totals.last7d === 0;
          return (
            <div key={c} className={clsx("ops-panel p-4", quiet && "opacity-70")}>
              <div className="flex items-center gap-2">
                <span className={clsx("size-2 rounded-full", CATEGORY_FILL[c])} aria-hidden />
                <h3 className={clsx("text-[13px] font-semibold", quiet ? "text-ops-muted" : CATEGORY_TEXT[c])}>{t(`category.${c}`)}</h3>
              </div>
              <p className="mt-2 flex items-baseline gap-3">
                <span className="text-2xl font-semibold tabular-nums text-ops-text">{totals.last7d}</span>
                <span className="text-[12px] text-ops-muted">
                  {t("threats.last7d")} · <span className="tabular-nums">{totals.last24h}</span> {t("threats.last24h")}
                </span>
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-ops-muted">{t(`categoryHint.${c}`)}</p>
            </div>
          );
        })}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <section aria-labelledby="recent-heading" className="ops-panel">
          <div className="border-b border-ops-border px-5 py-4">
            <h2 id="recent-heading" className="text-[15px] font-semibold text-ops-text">{t("threats.recent")}</h2>
          </div>
          {data.detections.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
              <ShieldQuestion className="size-6 text-ops-subtle" aria-hidden />
              <p className="text-sm text-ops-muted">{t("threats.empty")}</p>
            </div>
          ) : (
            <ul className="divide-y divide-ops-border">
              {data.detections.slice(0, 50).map((d) => (
                <DetectionRow key={d.id} d={d} locale={locale} />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="trend-heading" className="ops-panel p-5">
          <h2 id="trend-heading" className="text-[15px] font-semibold text-ops-text">{t("threats.trend")}</h2>
          <div className="mt-4">
            <Trend trend={data.trend} locale={locale} />
          </div>
          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]">
            {THREAT_CATEGORIES.map((c) => (
              <li key={c} className="flex items-center gap-1.5">
                <span className={clsx("size-2 rounded-sm", CATEGORY_FILL[c])} aria-hidden />
                <span className="text-ops-muted">{t(`category.${c}`)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Ignored detections: admin-only review material, collapsed by default. */}
      {data.isAdmin && data.ignored.length > 0 && (
        <section className="ops-panel">
          <button
            type="button"
            onClick={() => setShowIgnored((v) => !v)}
            aria-expanded={showIgnored}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
          >
            <span>
              <span className="text-[15px] font-semibold text-ops-text">{showIgnored ? t("threats.hideIgnored") : t("threats.showIgnored", { count: data.ignored.length })}</span>
              <span className="mt-0.5 block text-[12.5px] text-ops-muted">{t("threats.ignoredHint")}</span>
            </span>
            <ChevronDown className={clsx("size-4 shrink-0 text-ops-muted transition-transform", showIgnored && "rotate-180")} aria-hidden />
          </button>
          {showIgnored && (
            <ul className="divide-y divide-ops-border border-t border-ops-border">
              {data.ignored.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                  <span className={clsx("size-2 shrink-0 rounded-full", CATEGORY_FILL[d.category] ?? CATEGORY_FILL.pup)} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-ops-text">
                    {t("threats.found", { category: t(`category.${d.category}`), host: d.hostName ?? t("threats.unknownHost") })}
                  </span>
                  <span className="shrink-0 text-[12px] text-ops-muted">
                    {d.ignoredReason ? t(`ignoredReason.${d.ignoredReason}`) : d.ignoredReason}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-ops-subtle" aria-hidden />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
