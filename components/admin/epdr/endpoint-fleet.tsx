"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Search, ShieldCheck } from "lucide-react";
import clsx from "clsx";
import type { EpdrEndpointRow } from "@/actions/epdr-endpoints";
import { ATTENTION_BUCKETS, POSTURE_BUCKETS, SERVER_DEVICE_TYPE, type FleetPosture, type PostureBucket } from "@/lib/epdr/posture";
import EndpointDrawer from "./endpoint-drawer";

/** Fill colour per bucket — shared by the posture bar, the fleet map and the legends. */
const bucketFill: Record<PostureBucket, string> = {
  protected: "bg-ops-success",
  outdated: "bg-ops-success/45",
  disabled: "bg-ops-danger",
  error: "bg-ops-orange",
  install_error: "bg-ops-warning",
  no_license: "bg-ops-info",
  unknown: "bg-ops-subtle",
};

const bucketText: Record<PostureBucket, string> = {
  protected: "text-ops-success",
  outdated: "text-ops-success",
  disabled: "text-ops-danger",
  error: "text-ops-orange",
  install_error: "text-ops-warning",
  no_license: "text-ops-info",
  unknown: "text-ops-muted",
};

type Filter = "all" | "attention" | "offline" | "servers" | "unlinked";

function useRelative(locale: string) {
  return (date: Date | null) => {
    if (!date) return "—";
    const diffSec = Math.round((new Date(date).getTime() - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    const abs = Math.abs(diffSec);
    if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
    return rtf.format(Math.round(diffSec / 86400), "day");
  };
}

export default function EndpointFleet({
  posture,
  endpoints,
  isAdmin,
  locale,
}: {
  posture: FleetPosture;
  endpoints: EpdrEndpointRow[];
  isAdmin: boolean;
  locale: string;
}) {
  const t = useTranslations("Epdr");
  const relative = useRelative(locale);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  const byId = useMemo(() => new Map(endpoints.map((e) => [e.id, e])), [endpoints]);
  const open = openId !== null ? byId.get(openId) ?? null : null;

  const groups = useMemo(() => {
    const servers = endpoints.filter((e) => e.deviceType === SERVER_DEVICE_TYPE);
    const workstations = endpoints.filter((e) => e.deviceType === 1 || e.deviceType === 2);
    const other = endpoints.filter((e) => e.deviceType !== SERVER_DEVICE_TYPE && e.deviceType !== 1 && e.deviceType !== 2);
    return [
      { key: "servers", label: t("endpoints.servers"), items: servers },
      { key: "workstations", label: t("endpoints.workstations"), items: workstations },
      { key: "other", label: t("endpoints.otherDevices"), items: other },
    ].filter((g) => g.items.length > 0);
  }, [endpoints, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return endpoints.filter((e) => {
      if (filter === "attention" && !ATTENTION_BUCKETS.includes(e.bucket)) return false;
      if (filter === "offline" && !e.offline) return false;
      if (filter === "servers" && e.deviceType !== SERVER_DEVICE_TYPE) return false;
      if (filter === "unlinked" && e.deviceId !== null) return false;
      if (!q) return true;
      return e.hostName.toLowerCase().includes(q) || (e.ipAddress ?? "").toLowerCase().includes(q);
    });
  }, [endpoints, filter, query]);

  const attentionCount = posture.attention.length;
  const pct = posture.protectedPct ?? 0;
  const segments = POSTURE_BUCKETS.filter((b) => posture.counts[b] > 0);

  const filters: { key: Filter; count: number }[] = [
    { key: "all", count: posture.total },
    { key: "attention", count: attentionCount },
    { key: "offline", count: posture.offline },
    { key: "servers", count: endpoints.filter((e) => e.deviceType === SERVER_DEVICE_TYPE).length },
    { key: "unlinked", count: endpoints.filter((e) => e.deviceId === null).length },
  ];

  return (
    <>
      {/* Posture: the one number that matters, then the whole fleet as a single proportional bar. */}
      <section aria-labelledby="posture-heading" className="ops-panel p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="posture-heading" className="sr-only">{t("endpoints.protectedOf", { protected: posture.total - attentionCount, total: posture.total })}</h2>
            <p className="flex items-baseline gap-3">
              <span className="text-[44px] font-semibold leading-none tracking-[-0.03em] text-ops-text tabular-nums sm:text-[52px]">
                {pct.toLocaleString(locale, { maximumFractionDigits: 1 })}
                <span className="ml-0.5 text-[0.55em] font-medium text-ops-muted">%</span>
              </span>
              <span className="text-sm text-ops-muted">
                {t("endpoints.protectedOf", { protected: posture.counts.protected + posture.counts.outdated, total: posture.total })}
              </span>
            </p>
            <p className={clsx("mt-2 flex items-center gap-1.5 text-sm font-medium", attentionCount > 0 ? "text-ops-orange" : "text-ops-success")}>
              {attentionCount > 0 ? (
                <button type="button" onClick={() => setFilter("attention")} className="underline-offset-4 hover:underline">
                  {t("endpoints.needsAttention", { count: attentionCount })}
                </button>
              ) : (
                <>
                  <ShieldCheck className="size-4" aria-hidden />
                  {t("endpoints.allGood")}
                </>
              )}
            </p>
          </div>
        </div>

        <div className="mt-6 flex h-3 w-full overflow-hidden rounded-full bg-ops-surface-sunken" role="img" aria-label={segments.map((b) => `${t(`bucket.${b}`)} ${posture.counts[b]}`).join(", ")}>
          {segments.map((b) => (
            <div
              key={b}
              className={clsx("h-full origin-left motion-safe:animate-[ops-grow_700ms_var(--ease-out-quart)_backwards]", bucketFill[b])}
              style={{ width: `${(posture.counts[b] / Math.max(posture.total, 1)) * 100}%` }}
              title={`${t(`bucket.${b}`)}: ${posture.counts[b]}`}
            />
          ))}
        </div>

        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
          {POSTURE_BUCKETS.map((b) => (
            <li key={b} className={clsx("flex items-center gap-1.5", posture.counts[b] === 0 && "opacity-45")} title={t(`bucketHint.${b}`)}>
              <span className={clsx("size-2 rounded-sm", bucketFill[b])} aria-hidden />
              <span className="text-ops-muted">{t(`bucket.${b}`)}</span>
              <span className="font-medium text-ops-text tabular-nums">{posture.counts[b]}</span>
            </li>
          ))}
          <li className={clsx("flex items-center gap-1.5", posture.offline === 0 && "opacity-45")}>
            <span className="size-2 rounded-sm border border-ops-subtle" aria-hidden />
            <span className="text-ops-muted">{t("endpoints.filters.offline")}</span>
            <span className="font-medium text-ops-text tabular-nums">{posture.offline}</span>
          </li>
        </ul>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        {/* Fleet map: every device as one square, grouped by role. */}
        <section aria-labelledby="fleet-heading" className="ops-panel p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="fleet-heading" className="text-[15px] font-semibold text-ops-text">{t("endpoints.fleetMap")}</h2>
            <p className="text-[12px] text-ops-muted">{t("endpoints.fleetMapHint")}</p>
          </div>
          <div className="mt-4 space-y-5">
            {groups.map((group) => (
              <div key={group.key}>
                <p className="mb-2 text-[12px] font-medium text-ops-muted">
                  {group.label} <span className="tabular-nums text-ops-subtle">· {group.items.length}</span>
                </p>
                <div className="flex flex-wrap gap-[3px]">
                  {group.items.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setOpenId(e.id)}
                      title={`${e.hostName} · ${t(`bucket.${e.bucket}`)}${e.offline ? ` · ${t("endpoints.offlineFor")}` : ""}`}
                      aria-label={`${e.hostName}, ${t(`bucket.${e.bucket}`)}`}
                      className={clsx(
                        "size-3 rounded-[2px] transition-transform duration-150 ease-out hover:scale-[1.6] focus-visible:scale-[1.6] sm:size-3.5",
                        bucketFill[e.bucket],
                        e.offline && "opacity-35",
                      )}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Attention queue: worst first, servers and critical devices before the rest. */}
        <section aria-labelledby="attention-heading" className="ops-panel flex flex-col">
          <div className="flex items-baseline justify-between gap-2 border-b border-ops-border px-5 py-4">
            <h2 id="attention-heading" className="text-[15px] font-semibold text-ops-text">{t("endpoints.attention")}</h2>
            <span className="text-[13px] font-medium tabular-nums text-ops-muted">{attentionCount}</span>
          </div>
          {attentionCount === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-center">
              <ShieldCheck className="size-6 text-ops-success" aria-hidden />
              <p className="text-sm text-ops-muted">{t("endpoints.attentionEmpty")}</p>
            </div>
          ) : (
            <ul className="max-h-[22rem] divide-y divide-ops-border overflow-y-auto">
              {posture.attention.slice(0, 50).map((a) => {
                const e = byId.get(a.id);
                if (!e) return null;
                return (
                  <li key={e.id}>
                    <button type="button" onClick={() => setOpenId(e.id)} className="group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-ops-surface-raised">
                      <span className={clsx("size-2 shrink-0 rounded-full", bucketFill[e.bucket])} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-ops-text">{e.hostName}</span>
                          {(e.deviceType === SERVER_DEVICE_TYPE || e.isCritical) && (
                            <span className="shrink-0 rounded-sm border border-ops-border-strong px-1 text-[10.5px] font-medium uppercase tracking-wide text-ops-muted">
                              {e.isCritical ? t("endpoints.critical") : t("endpoints.server")}
                            </span>
                          )}
                        </span>
                        <span className={clsx("block text-[12.5px]", bucketText[e.bucket])}>{t(`bucket.${e.bucket}`)}</span>
                      </span>
                      <span className="shrink-0 text-[12px] tabular-nums text-ops-subtle">{relative(e.lastConnectionAt)}</span>
                      <ChevronRight className="size-4 shrink-0 text-ops-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Full list with filters. */}
      <section aria-labelledby="all-heading" className="ops-panel">
        <div className="flex flex-col gap-3 border-b border-ops-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <h2 id="all-heading" className="text-[15px] font-semibold text-ops-text">{t("endpoints.allDevices")}</h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("endpoints.allDevices")}>
              {filters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={clsx(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
                    filter === f.key ? "bg-ops-accent-soft text-ops-accent" : "text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text",
                  )}
                >
                  {t(`endpoints.filters.${f.key}`)}
                  <span className="tabular-nums opacity-75">{f.count}</span>
                </button>
              ))}
            </div>
            <label className="relative">
              <span className="sr-only">{t("endpoints.search")}</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ops-subtle" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(ev) => setQuery(ev.target.value)}
                placeholder={t("endpoints.search")}
                className="ops-input h-8 w-full pl-8 pr-3 text-[13px] sm:w-56"
              />
            </label>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ops-muted">{t("endpoints.noResults")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-ops-border">
                  <th className="px-5 py-2.5">{t("endpoints.columns.device")}</th>
                  <th className="px-3 py-2.5">{t("endpoints.columns.status")}</th>
                  <th className="px-3 py-2.5">{t("endpoints.columns.type")}</th>
                  <th className="px-3 py-2.5">{t("endpoints.columns.lastSeen")}</th>
                  <th className="px-3 py-2.5">{t("endpoints.columns.asset")}</th>
                  <th className="w-10 px-3 py-2.5"><span className="sr-only">{t("drawer.details")}</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map((e) => (
                  <tr key={e.id} onClick={() => setOpenId(e.id)} className="cursor-pointer border-b border-ops-border/60 hover:bg-ops-surface-raised">
                    <td className="px-5 py-2.5">
                      <span className="font-medium text-ops-text">{e.hostName}</span>
                      {e.ipAddress && <span className="ml-2 font-mono text-[12px] text-ops-subtle">{e.ipAddress}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={clsx("size-2 rounded-full", bucketFill[e.bucket])} aria-hidden />
                        <span className={bucketText[e.bucket]}>{t(`bucket.${e.bucket}`)}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-ops-muted">{t(`deviceType.${e.deviceType && [1, 2, 3, 4].includes(e.deviceType) ? e.deviceType : "unknown"}`)}</td>
                    <td className={clsx("px-3 py-2.5 tabular-nums", e.offline ? "text-ops-warning" : "text-ops-muted")}>{relative(e.lastConnectionAt)}</td>
                    <td className="px-3 py-2.5 text-ops-muted">{e.assetName ?? <span className="text-ops-subtle">{t("endpoints.unlinked")}</span>}</td>
                    <td className="px-3 py-2.5">
                      <button type="button" aria-label={`${t("drawer.details")}: ${e.hostName}`} onClick={(ev) => { ev.stopPropagation(); setOpenId(e.id); }} className="text-ops-subtle hover:text-ops-text">
                        <ChevronRight className="size-4" aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <EndpointDrawer endpoint={open} isAdmin={isAdmin} locale={locale} onClose={() => setOpenId(null)} />
    </>
  );
}
