"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { EpdrOverview } from "@/actions/epdr-overview";
import { useEpdrTimeZone } from "./time-zone-provider";
import { formatEpdrDateTime } from "@/lib/epdr/time-zone";

export default function OperationsOverview({ data, locale }: { data: EpdrOverview; locale: string }) {
  const t = useTranslations("Epdr.overview");
  const { timeZone } = useEpdrTimeZone();
  const c = data.counts;
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const endpoint = (filter: string) => `/admin/epdr/endpoints?filter=${filter}`;
  const queue = c ? [
    { key: "highScore", count: c.highScore, href: "/admin/epdr/threats?scoreMode=range&minScore=7&maxScore=10&sort=scoreHigh" },
    ...(data.isAdmin ? [
      // "Needs attention" is a provider-request state group on the Actions page;
      // the ledger's normalized status vocabulary has no equivalent single value.
      { key: "review", count: c.review, href: "/admin/epdr/approvals?group=review" },
      { key: "pending", count: c.pending, href: "/admin/epdr/approvals?group=approval" },
    ] : []),
    ...(["disabled", "error", "install_error", "no_license", "outdated", "unknown", "offline", "unknown_contact"] as const)
      .map((key) => ({ key, count: c[key], href: endpoint(key === "unknown_contact" ? "unknown_contact" : key) })),
  ].filter((item) => item.count > 0) : [];
  return <div className="flex flex-col gap-6">
    <section className="ops-panel p-5" aria-labelledby="overview-confidence">
      <h2 id="overview-confidence" className="text-lg font-semibold text-ops-text">{t("confidenceTitle")}</h2>
      <p className="mt-1 text-sm text-ops-muted">{t("confidenceDescription")}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {data.sources.map((source) => <div key={source.source} className="rounded-lg border border-ops-border p-3">
          <h3 className="text-sm font-medium text-ops-text">{t(`sources.${source.source}`)}</h3>
          <p className="mt-1 text-sm text-ops-muted">{t(`states.${source.state}`)}</p>
          <p className="mt-1 text-xs text-ops-muted">{source.lastSyncAt ? formatEpdrDateTime(source.lastSyncAt, timeZone, locale) : t("neverSynced")}</p>
        </div>)}
      </div>
    </section>
    {!data.available || !c ? <section className="ops-panel p-6 text-sm text-ops-muted" role="status">{t("unavailable")}</section> : <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("metrics")}>
        {[
          { key: "total", value: c.total, href: "/admin/epdr/endpoints" },
          { key: "protected", value: c.protected, href: endpoint("protected") },
          { key: "threats", value: c.threats, href: "/admin/epdr/threats" },
          { key: "unknown", value: c.unknown, href: endpoint("unknown") },
        ].map((item) => <Link key={item.key} href={item.href} className="ops-panel p-5 transition-colors hover:border-ops-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ops-accent">
          <p className="text-sm text-ops-muted">{t(`metricsLabels.${item.key}`)}</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-ops-text">{number(item.value)}</p>
          <p className="mt-2 text-xs text-ops-muted">{t(item.key === "threats" ? "threatWindow" : "currentBinding")}</p>
        </Link>)}
      </section>
      <section className="ops-panel overflow-hidden" aria-labelledby="overview-queue">
        <div className="border-b border-ops-border p-5">
          <h2 id="overview-queue" className="text-lg font-semibold text-ops-text">{t("queueTitle")}</h2>
          <p className="mt-1 text-sm text-ops-muted">{t("queueDescription")}</p>
        </div>
        {queue.length ? <ul className="divide-y divide-ops-border">{queue.map((item, index) => <li key={item.key}>
          <Link href={item.href} className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-ops-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-ops-accent">
            <span className="text-xs tabular-nums text-ops-muted">{String(index + 1).padStart(2, "0")}</span>
            <span className="min-w-0 flex-1 text-sm text-ops-text">{t(`queue.${item.key}`)}</span>
            <span className="font-semibold tabular-nums text-ops-text">{number(item.count)}</span>
            <span aria-hidden="true" className="text-ops-muted">→</span>
          </Link>
        </li>)}</ul> : <p className="p-5 text-sm text-ops-muted">{t("emptyQueue")}</p>}
      </section>
    </>}
  </div>;
}
