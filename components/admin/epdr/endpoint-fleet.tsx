"use client";

import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, CircleAlert, Clock3, LayoutGrid, LoaderCircle, RefreshCw, Search, ShieldCheck, Star, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { getEpdrEndpointPage, type EpdrEndpointPage, type EpdrEndpointRow, type EpdrFleetSummary } from "@/actions/epdr-endpoints";
import StatusBadge from "@/components/ui/status-badge";
import { DataTable, DataTableBody, DataTableHead } from "@/components/ui/data-table";
import type { FleetQuery } from "@/lib/epdr/fleet-query";
import { POSTURE_BUCKETS, SERVER_DEVICE_TYPE, type FleetPosture, type PostureEndpoint, type PostureBucket } from "@/lib/epdr/posture";
import type { UiTone } from "@/lib/ui/status";
import EndpointDrawer from "./endpoint-drawer";

/** Status colours are shared by the distribution, map, and endpoint rows. */
const bucketFill: Record<PostureBucket, string> = {
  protected: "bg-ops-success",
  outdated: "bg-ops-success/45",
  disabled: "bg-ops-danger",
  error: "bg-ops-orange",
  install_error: "bg-ops-warning",
  no_license: "bg-ops-info",
  unknown: "bg-ops-subtle",
};

const bucketStroke: Record<PostureBucket, string> = {
  protected: "stroke-ops-success",
  outdated: "stroke-ops-success/45",
  disabled: "stroke-ops-danger",
  error: "stroke-ops-orange",
  install_error: "stroke-ops-warning",
  no_license: "stroke-ops-info",
  unknown: "stroke-ops-subtle",
};

const bucketTone: Record<PostureBucket, UiTone> = {
  protected: "success",
  outdated: "success",
  disabled: "danger",
  error: "orange",
  install_error: "warning",
  no_license: "info",
  unknown: "neutral",
};

const toneText: Record<UiTone, string> = {
  neutral: "text-ops-subtle",
  success: "text-ops-success",
  warning: "text-ops-warning",
  orange: "text-ops-orange",
  danger: "text-ops-danger",
  info: "text-ops-info",
  accent: "text-ops-accent",
};

type Translate = (key: string, values?: Record<string, string | number>) => string;

function SectionHeading({ id, title, description, icon, action }: { id?: string; title: string; description?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-ops-muted [&_svg]:size-4" aria-hidden>{icon}</span>}
        <div>
          <h2 id={id} className="text-[15px] font-semibold tracking-[-0.015em] text-ops-text">{title}</h2>
          {description && <p className="mt-1 max-w-2xl text-xs leading-5 text-ops-muted">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}


function DeviceIcon({ type, className }: { type: number | null; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden className={className}>
      <rect x="4" y="3" width="12" height="10" rx="1.5" />
      {type === SERVER_DEVICE_TYPE ? <><path d="M4 7h12M4 10h12" /><path d="M6 5h.01M6 8.5h.01M6 11.5h.01" strokeLinecap="round" /></> : <path d="M2 16.5h16M7 13l-.5 3.5M13 13l.5 3.5" strokeLinecap="round" />}
    </svg>
  );
}

type Filter = FleetQuery["filter"];

function ProtectionDistribution({ posture, locale, t }: { posture: FleetPosture; locale: string; t: Translate }) {
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const segments = POSTURE_BUCKETS.filter((bucket) => posture.counts[bucket] > 0).map((bucket, index, visible) => ({
    bucket,
    length: (posture.counts[bucket] / Math.max(posture.total, 1)) * circumference,
    offset: visible.slice(0, index).reduce((sum, previous) => sum + (posture.counts[previous] / Math.max(posture.total, 1)) * circumference, 0),
  }));
  return (
    <div className="shrink-0">
      <svg viewBox="0 0 128 128" className="size-36 -rotate-90" role="img" aria-label={segments.map(({ bucket }) => `${t(`bucket.${bucket}`)} ${posture.counts[bucket]}`).join(", ")}>
        <circle cx="64" cy="64" r={radius} fill="none" strokeWidth="11" className="stroke-ops-surface-raised" />
        {segments.map(({ bucket, length, offset }) => (
          <circle key={bucket} cx="64" cy="64" r={radius} fill="none" strokeWidth="11" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} className={bucketStroke[bucket]} />
        ))}
        <g transform="rotate(90 64 64)">
          <text x="64" y="62" textAnchor="middle" className="fill-ops-text text-[27px] font-semibold tracking-[-1px] tabular-nums">{posture.protectedPct === null ? "—" : posture.protectedPct.toLocaleString(locale, { maximumFractionDigits: 1 })}<tspan className="fill-ops-muted text-[13px] font-medium">{posture.protectedPct === null ? "" : "%"}</tspan></text>
          <text x="64" y="79" textAnchor="middle" className="fill-ops-muted text-[9px] font-medium">{t("fleetV2.protected")}</text>
        </g>
      </svg>
    </div>
  );
}

function Metric({ label, value, icon, tone = "neutral", onClick }: { label: string; value: number; icon: ReactNode; tone?: UiTone; onClick?: () => void }) {
  const content = (
    <>
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-xs font-medium text-ops-muted group-hover:text-ops-text">{label}</span>
        <span className={toneText[tone]}>{icon}</span>
      </div>
      <span className="text-[25px] font-semibold leading-none tracking-[-0.03em] text-ops-text tabular-nums">{value}</span>
    </>
  );
  return (
    <div className="min-w-0 border-ops-border p-3.5 odd:border-r border-b [&:nth-last-child(-n+2)]:border-b-0 sm:[&:nth-child(n)]:border-r-0 sm:[&:nth-child(3n+1)]:border-r sm:[&:nth-child(3n+2)]:border-r sm:[&:nth-last-child(-n+3)]:border-b-0">
      {onClick ? <button type="button" onClick={onClick} className="group flex w-full flex-col gap-3 rounded-sm text-left">{content}</button> : <div className="group flex flex-col gap-3">{content}</div>}
    </div>
  );
}

function FleetMap({ groups, total, summary, onOpen, t }: { groups: { key: string; label: string; items: EpdrEndpointRow[] }[]; total: number; summary?: EpdrFleetSummary; onOpen: (id: number) => void; t: Translate }) {
  return (
    <section aria-labelledby="map-heading" className="ops-panel min-w-0 overflow-hidden">
      <div className="border-b border-ops-border px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <LayoutGrid className="mt-0.5 size-4 text-ops-muted" aria-hidden />
            <div>
              <h2 id="map-heading" className="text-[15px] font-semibold text-ops-text">{t("endpoints.fleetMap")}</h2>
              <p className="mt-1 text-xs text-ops-muted">{t("endpoints.fleetMapHint")}</p>
            </div>
          </div>
          <span className="shrink-0 rounded-md border border-ops-border bg-ops-surface-raised px-2 py-1 text-xs text-ops-muted tabular-nums">{summary?.mapTruncated ? t("fleetV2.mapShown", { count: summary.mapLimit, total }) : total}</span>
        </div>
      </div>
      <div className="space-y-5 px-5 py-5">
        {groups.map((group) => (
          <div key={group.key}>
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <h3 className="text-xs font-medium text-ops-muted">{group.label}</h3>
              <span className="font-mono text-[11px] text-ops-subtle tabular-nums">{group.items.length}</span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(1.25rem,1fr))] gap-1.5">
              {group.items.map((endpoint) => (
                <button key={endpoint.id} type="button" onClick={() => onOpen(endpoint.id)} title={`${endpoint.hostName} · ${t(`bucket.${endpoint.bucket}`)}${endpoint.offline ? ` · ${t("endpoints.offlineFor")}` : ""}`} aria-label={`${endpoint.hostName}, ${t(`bucket.${endpoint.bucket}`)}${endpoint.offline ? `, ${t("endpoints.offlineFor")}` : ""}`} className={clsx("relative aspect-square min-h-5 rounded-[3px] ring-1 ring-inset ring-white/10 transition-[transform,filter] duration-150 hover:z-10 hover:scale-125 hover:brightness-125 focus-visible:z-10 focus-visible:scale-125", bucketFill[endpoint.bucket], endpoint.offline && "opacity-45")}>
                  {(endpoint.offline || endpoint.isCritical) && <span className="absolute inset-[3px] rounded-[1px] border border-ops-bg/75" aria-hidden />}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-ops-border bg-ops-surface-sunken/40 px-5 py-3">
        {POSTURE_BUCKETS.map((bucket) => (
          <span key={bucket} className="flex items-center gap-1.5 text-[11px] text-ops-muted" title={t(`bucketHint.${bucket}`)}><span className={clsx("size-2 rounded-[2px]", bucketFill[bucket])} aria-hidden />{t(`bucket.${bucket}`)}</span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px] text-ops-muted"><span className="size-2 rounded-[2px] border border-ops-subtle opacity-60" aria-hidden />{t("endpoints.offlineFor")}</span>
      </div>
      {summary?.mapTruncated && <p className="border-t border-ops-border px-5 py-3 text-xs leading-5 text-ops-warning">{t("endpoints.mapSample", { count: summary.mapLimit })}</p>}
    </section>
  );
}

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
  summary,
  isAdmin,
  locale,
}: {
  posture: FleetPosture;
  /** Bounded map sample; table rows are fetched separately per page. */
  endpoints: EpdrEndpointRow[];
  summary?: EpdrFleetSummary;
  isAdmin: boolean;
  locale: string;
}) {
  const t = useTranslations("Epdr");
  const relative = useRelative(locale);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const v = useTranslations("Epdr.fleetV2");
  const [openId, setOpenId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [group, setGroup] = useState("");
  const [os, setOs] = useState("");
  const [deviceType, setDeviceType] = useState<FleetQuery["deviceType"]>("");
  const [sort, setSort] = useState<FleetQuery["sort"]>("name");
  const [result, setResult] = useState<EpdrEndpointPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const data = await getEpdrEndpointPage({ page, query, filter, group, os, deviceType, sort });
        if (!active) return;
        if ("message" in data) { setError(true); setResult(null); }
        else { setError(false); setResult(data); }
      } catch { if (active) { setError(true); setResult(null); } }
      finally { if (active) setLoading(false); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [page, query, filter, group, os, deviceType, sort, retry, endpoints]);
  function changeFilter(next: Filter) {
    if (next === filter && page === 1) return;
    setLoading(true); setFilter(next); setPage(1);
  }
  const filtered = loading || error ? [] : result?.rows ?? [];
  const groupOptions = summary?.groups ?? [...new Set(endpoints.flatMap((e) => e.groupPath ? [e.groupPath] : []))].sort();
  const osOptions = summary?.operatingSystems ?? [...new Set(endpoints.flatMap((e) => e.operatingSystem ? [e.operatingSystem] : []))].sort();

  const byId = useMemo(() => new Map([...endpoints, ...(result?.rows ?? [])].map((e) => [e.id, e])), [endpoints, result]);
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

  const attentionCount = posture.counts.disabled + posture.counts.error + posture.counts.install_error + posture.counts.unknown;

  const filters: { key: Filter; count: number }[] = [
    { key: "all", count: posture.total },
    { key: "attention", count: attentionCount },
    { key: "offline", count: posture.offline },
    { key: "outdated", count: posture.counts.outdated },
    { key: "unknown_contact", count: summary?.unknownContact ?? endpoints.filter((e) => e.lastConnectionAt === null).length },
    { key: "unlinked", count: summary?.unlinked ?? endpoints.filter((e) => e.deviceId === null).length },
  ];

  return (
    <>
      <section aria-labelledby="posture-heading" className="ops-panel overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(28rem,0.9fr)]">
          <div className="p-5 sm:p-6">
            <SectionHeading id="posture-heading" title={v("healthTitle")} description={v("healthDescription")} icon={<ShieldCheck />} />            <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
              <ProtectionDistribution posture={posture} locale={locale} t={t} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ops-text">{t("endpoints.protectedOf", { protected: posture.counts.protected + posture.counts.outdated, total: posture.total })}</p>
                <button type="button" onClick={() => changeFilter("attention")} className={clsx("mt-2 flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline", attentionCount > 0 ? "text-ops-orange" : "text-ops-success")}>
                  {attentionCount > 0 ? <TriangleAlert className="size-4" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
                  {attentionCount > 0 ? t("endpoints.needsAttention", { count: attentionCount }) : t("endpoints.allGood")}
                </button>
                <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3">
                  {POSTURE_BUCKETS.map((bucket) => (
                    <li key={bucket} className={clsx("flex min-w-0 items-center gap-2 text-xs", posture.counts[bucket] === 0 && "opacity-55")} title={t(`bucketHint.${bucket}`)}>
                      <span className={clsx("size-2 shrink-0 rounded-[2px]", bucketFill[bucket])} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-ops-muted">{t(`bucket.${bucket}`)}</span>
                      <span className="font-medium text-ops-text tabular-nums">{posture.counts[bucket]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <dl className="grid grid-cols-2 border-t border-ops-border bg-ops-surface-sunken/30 sm:grid-cols-3 lg:border-l lg:border-t-0">
            <Metric label={v("filters.attention")} value={attentionCount} icon={<TriangleAlert className="size-4" aria-hidden />} tone={attentionCount > 0 ? "orange" : "success"} onClick={() => changeFilter("attention")} />
            <Metric label={v("filters.offline")} value={posture.offline} icon={<Clock3 className="size-4" aria-hidden />} tone={posture.offline > 0 ? "warning" : "neutral"} onClick={() => changeFilter("offline")} />
            <Metric label={v("filters.outdated")} value={posture.counts.outdated} icon={<RefreshCw className="size-4" aria-hidden />} tone={posture.counts.outdated > 0 ? "info" : "neutral"} onClick={() => changeFilter("outdated")} />
            <Metric label={t("endpoints.critical")} value={summary?.critical ?? endpoints.filter((e) => e.isCritical).length} icon={<Star className="size-4" aria-hidden />} tone={(summary?.critical ?? 0) > 0 ? "orange" : "neutral"} />
            <Metric label={v("filters.unknown_contact")} value={summary?.unknownContact ?? endpoints.filter((e) => e.lastConnectionAt === null).length} icon={<CircleAlert className="size-4" aria-hidden />} tone={(summary?.unknownContact ?? endpoints.filter((e) => e.lastConnectionAt === null).length) > 0 ? "warning" : "neutral"} onClick={() => changeFilter("unknown_contact")} />
            <Metric label={v("filters.unlinked")} value={summary?.unlinked ?? endpoints.filter((e) => e.deviceId === null).length} icon={<LayoutGrid className="size-4" aria-hidden />} onClick={() => changeFilter("unlinked")} />
          </dl>
        </div>
        <p className="border-t border-ops-border bg-ops-surface-sunken/30 px-5 py-3 text-xs leading-5 text-ops-muted">{v("connectivityNote")}</p>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(20rem,0.8fr)]">
        <FleetMap groups={groups} total={posture.total} summary={summary} onOpen={setOpenId} t={t} />
        <section aria-labelledby="attention-heading" className="ops-panel flex min-w-0 flex-col overflow-hidden">
          <div className="border-b border-ops-border px-5 py-4">
            <SectionHeading id="attention-heading" title={t("endpoints.attention")} description={v("attentionDescription")} icon={<TriangleAlert />} action={attentionCount > 0 ? <button type="button" onClick={() => changeFilter("attention")} className="inline-flex items-center gap-1 text-xs font-medium text-ops-accent underline-offset-4 hover:underline">{v("seeAll", { count: attentionCount })}<ChevronRight className="size-3.5" aria-hidden /></button> : undefined} />
          </div>
          {attentionCount === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-14 text-center">
              <span className="flex size-11 items-center justify-center rounded-lg bg-ops-success-soft text-ops-success"><ShieldCheck className="size-5" aria-hidden /></span>
              <div><p className="text-sm font-medium text-ops-text">{t("endpoints.attentionEmpty")}</p><p className="mt-1 text-xs text-ops-muted">{v("attentionEmptyHint")}</p></div>
            </div>
          ) : (
            <ul aria-label={v("prioritySample", { count: Math.min(50, attentionCount) })} className="max-h-[29rem] divide-y divide-ops-border overflow-y-auto">
              {posture.attention.slice(0, 50).map((endpoint: PostureEndpoint) => (

                  <li key={endpoint.id}>
                    <button type="button" onClick={() => setOpenId(endpoint.id)} className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ops-surface-raised">
                      <span className={clsx("flex size-8 shrink-0 items-center justify-center rounded-md border border-ops-border bg-ops-surface-raised", toneText[bucketTone[endpoint.bucket]])}><DeviceIcon type={endpoint.deviceType} className="size-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5"><span className="truncate text-[13px] font-medium text-ops-text">{endpoint.hostName}</span>{(endpoint.deviceType === SERVER_DEVICE_TYPE || endpoint.isCritical) && <span className="shrink-0 rounded-sm border border-ops-border-strong px-1 text-[10px] font-medium text-ops-muted">{endpoint.isCritical ? t("endpoints.critical") : t("endpoints.server")}</span>}</span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-ops-muted"><span className={clsx("size-1.5 shrink-0 rounded-full", bucketFill[endpoint.bucket])} aria-hidden /><span className="truncate">{t(`bucket.${endpoint.bucket}`)}</span>{endpoint.offline && <span className="shrink-0 text-ops-warning">· {t("endpoints.offlineFor")}</span>}</span>
                      </span>
                      <span className="shrink-0 text-right text-[11px] tabular-nums text-ops-subtle">{relative(endpoint.lastConnectionAt)}</span>
                      <ChevronRight className="size-4 shrink-0 text-ops-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </button>
                  </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="all-heading" className="ops-panel overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-ops-border px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="shrink-0"><h2 id="all-heading" className="text-[15px] font-semibold text-ops-text">{t("endpoints.allDevices")}</h2><p className="mt-1 text-xs text-ops-muted">{v("inventoryDescription")}</p></div>
          <label className="relative block xl:w-72">
            <span className="sr-only">{t("endpoints.search")}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-subtle" aria-hidden />
            <input type="search" value={query} maxLength={80} onChange={(ev) => { setLoading(true); setQuery(ev.target.value); setPage(1); }} placeholder={t("endpoints.search")} className="ops-input h-9 w-full pl-9 pr-3 text-[13px]" />
          </label>
        </div>
        <div className="flex flex-col gap-3 border-b border-ops-border bg-ops-surface-sunken/30 px-5 py-4">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("endpoints.allDevices")}>
            {filters.map((item) => (
              <button key={item.key} type="button" aria-pressed={filter === item.key} onClick={() => changeFilter(item.key)} className={clsx("inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors", filter === item.key ? "border-ops-accent/30 bg-ops-accent-soft text-ops-accent" : "border-transparent text-ops-muted hover:border-ops-border hover:bg-ops-surface-raised hover:text-ops-text")}>
                {v(`filters.${item.key}`)}<span className="tabular-nums opacity-75">{item.count}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4 xl:max-w-4xl">
            <label className="flex min-w-0 items-center gap-2 text-xs">
              <span className="shrink-0 text-ops-muted">{v("group")}</span>
              <select value={group} className="ops-input h-8 min-w-0 flex-1 px-2 text-xs" onChange={(event) => { setLoading(true); setPage(1); setGroup(event.target.value); }}>
                <option value="">{v("any")}</option>
                {groupOptions.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="flex min-w-0 items-center gap-2 text-xs">
              <span className="shrink-0 text-ops-muted">{v("os")}</span>
              <select value={os} className="ops-input h-8 min-w-0 flex-1 px-2 text-xs" onChange={(event) => { setLoading(true); setPage(1); setOs(event.target.value); }}>
                <option value="">{v("any")}</option>
                {osOptions.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="flex min-w-0 items-center gap-2 text-xs">
              <span className="shrink-0 text-ops-muted">{v("deviceType")}</span>
              <select value={deviceType} className="ops-input h-8 min-w-0 flex-1 px-2 text-xs" onChange={(event) => { setLoading(true); setPage(1); setDeviceType(event.target.value as FleetQuery["deviceType"]); }}>
                <option value="">{v("any")}</option>
                {(["1", "2", "3", "4"] as const).map((value) => <option key={value} value={value}>{t(`deviceType.${value}`)}</option>)}
              </select>
            </label>
            <label className="flex min-w-0 items-center gap-2 text-xs">
              <span className="shrink-0 text-ops-muted">{v("sort")}</span>
              <select value={sort} className="ops-input h-8 min-w-0 flex-1 px-2 text-xs" onChange={(event) => { setLoading(true); setPage(1); setSort(event.target.value as FleetQuery["sort"]); }}>
                <option value="name">{v("name")}</option>
                <option value="contact">{v("contact")}</option>
              </select>
            </label>
          </div>
        </div>
        {loading ? <div role="status" className="flex min-h-52 flex-col items-center justify-center gap-3 p-5 text-sm text-ops-muted"><LoaderCircle className="size-5 animate-spin" aria-hidden />{v("loading")}</div> : error ? <div role="alert" className="flex min-h-52 flex-col items-center justify-center gap-3 p-5 text-center"><CircleAlert className="size-6 text-ops-danger" aria-hidden /><p className="text-sm text-ops-danger">{v("error")}</p><button type="button" onClick={() => { setLoading(true); setRetry((n) => n + 1); }} className="inline-flex h-8 items-center gap-2 rounded-md border border-ops-border-strong px-3 text-xs font-medium text-ops-text transition-colors hover:bg-ops-surface-raised"><RefreshCw aria-hidden />{v("retry")}</button></div> : filtered.length === 0 ? <div className="flex min-h-52 flex-col items-center justify-center gap-3 px-5 py-10 text-center"><Search className="size-6 text-ops-subtle" aria-hidden /><p className="text-sm text-ops-muted">{t("endpoints.noResults")}</p></div> : (
          <DataTable className="min-w-[850px] text-[13px]">
            <DataTableHead><tr><th className="px-5">{t("endpoints.columns.device")}</th><th className="px-3">{t("endpoints.columns.status")}</th><th className="px-3">{t("endpoints.columns.type")}</th><th className="px-3">{t("endpoints.columns.lastSeen")}</th><th className="px-3">{t("endpoints.columns.asset")}</th><th className="w-10 px-3"><span className="sr-only">{t("drawer.details")}</span></th></tr></DataTableHead>
            <DataTableBody>
              {filtered.map((endpoint) => (
                <tr key={endpoint.id} onClick={() => setOpenId(endpoint.id)} className="group cursor-pointer">
                  <td className="max-w-72 px-5 py-3"><div className="flex items-center gap-3"><DeviceIcon type={endpoint.deviceType} className="size-5 shrink-0 text-ops-subtle transition-colors group-hover:text-ops-accent" /><div className="min-w-0"><div className="flex items-center gap-1.5"><span className="truncate font-medium text-ops-text">{endpoint.hostName}</span>{endpoint.isCritical && <Star className="size-3 shrink-0 fill-ops-orange-soft text-ops-orange" aria-label={t("endpoints.critical")} />}</div><p className="mt-0.5 truncate text-xs text-ops-subtle">{[endpoint.ipAddress, endpoint.groupPath].filter(Boolean).join(" · ") || endpoint.operatingSystem || "—"}</p></div></div></td>
                  <td className="whitespace-nowrap px-3 py-3"><StatusBadge tone={bucketTone[endpoint.bucket]} dot>{t(`bucket.${endpoint.bucket}`)}</StatusBadge></td>
                  <td className="px-3 py-3 text-ops-muted">{t(`deviceType.${endpoint.deviceType && [1, 2, 3, 4].includes(endpoint.deviceType) ? endpoint.deviceType : "unknown"}`)}</td>
                  <td className={clsx("whitespace-nowrap px-3 py-3 tabular-nums", endpoint.offline ? "text-ops-warning" : "text-ops-muted")}>{relative(endpoint.lastConnectionAt)}</td>
                  <td className="max-w-48 truncate px-3 py-3 text-ops-muted">{endpoint.assetName ?? <span className="text-ops-subtle">{t("endpoints.unlinked")}</span>}</td>
                  <td className="px-3 py-3"><button type="button" aria-label={`${t("drawer.details")}: ${endpoint.hostName}`} onClick={(event: MouseEvent) => { event.stopPropagation(); setOpenId(endpoint.id); }} className="flex size-7 items-center justify-center rounded-md text-ops-subtle transition-colors hover:bg-ops-surface-raised hover:text-ops-text"><ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></button></td>
                </tr>
              ))}
            </DataTableBody>
          </DataTable>
        )}
        {!loading && !error && result && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ops-border px-5 py-3 text-xs text-ops-muted"><p role="status">{v("page", { page: result.page, pages: Math.max(1, Math.ceil(result.total / result.pageSize)), total: result.total })}</p><div className="flex gap-1"><button type="button" disabled={result.page <= 1} onClick={() => { setLoading(true); setPage(result.page - 1); }} className="inline-flex h-8 items-center gap-1 rounded-md border border-ops-border px-2.5 transition-colors hover:bg-ops-surface-raised hover:text-ops-text disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="size-3.5" aria-hidden />{v("previous")}</button><button type="button" disabled={result.page * result.pageSize >= result.total} onClick={() => { setLoading(true); setPage(result.page + 1); }} className="inline-flex h-8 items-center gap-1 rounded-md border border-ops-border px-2.5 transition-colors hover:bg-ops-surface-raised hover:text-ops-text disabled:cursor-not-allowed disabled:opacity-40">{v("next")}<ChevronRight className="size-3.5" aria-hidden /></button></div></div>}
      </section>
      <EndpointDrawer endpoint={open} isAdmin={isAdmin} locale={locale} onClose={() => setOpenId(null)} />
    </>
  );
}
