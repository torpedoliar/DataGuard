"use client";

import ActionButton from "@/components/ui/action-button";
import DataToolbar from "@/components/ui/data-toolbar";
import {
  DataTable,
  DataTableBody,
  DataTableEmpty,
  DataTableFrame,
  DataTableHead,
} from "@/components/ui/data-table";
import StatusBadge from "@/components/ui/status-badge";
import type { InjectionIndicator } from "@/lib/siem/injection-inspector";
import { AlertTriangle, ArrowLeft, ArrowRight, Filter, Search, ShieldCheck, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useMemo } from "react";

type ParsedEventRow = {
  id: number;
  rawEventId: number;
  eventTime: Date | null;
  receivedAt: Date;
  sourceIp: string;
  hostname: string | null;
  severity: number | null;
  facility: number | null;
  priority: number | null;
  appName: string | null;
  program: string | null;
  message: string;
  siteName: string | null;
  deviceName: string | null;
  sourceDisplayName: string | null;
  vendor: "generic" | "mikrotik" | "cisco" | "fortigate" | "linux" | "watchguard" | "paloalto" | "juniper" | "checkpoint" | null;
  parser: string;
  category: string | null;
  normalizedType: string | null;
  action: string | null;
  outcome: string | null;
  srcIp: string | null;
  dstIp: string | null;
  username: string | null;
  interfaceName: string | null;
  tags: string[];
  rawMessage: string | null;
  injectionIndicators: InjectionIndicator[];
};

type RawEventRow = {
  id: number;
  receivedAt: Date;
  sourceIp: string;
  sourcePort: number;
  transport: "udp" | "tcp" | "tls";
  rawMessage: string;
  rawSize: number;
  ingestStatus: "received" | "parsed" | "parse_failed" | "dropped";
  parseError: string | null;
  injectionIndicators: InjectionIndicator[];
};

type ExplorerData = {
  events: ParsedEventRow[];
  rawEvents: RawEventRow[];
  totalEvents: number;
  totalRawEvents: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
};

const fieldClass = "ops-input h-9 px-3 text-sm";
const statuses = ["received", "parsed", "parse_failed", "dropped"] as const;

function severityTone(severity: number | null) {
  if (severity === null) return "neutral";
  if (severity <= 2) return "danger";
  if (severity <= 4) return "warning";
  return "neutral";
}

function statusTone(status: RawEventRow["ingestStatus"]) {
  if (status === "parsed") return "success";
  if (status === "parse_failed") return "danger";
  if (status === "dropped") return "warning";
  return "info";
}

function indicatorTone(severity: InjectionIndicator["severity"]) {
  if (severity === "high") return "danger";
  if (severity === "medium") return "warning";
  return "info";
}

import { formatWibDateTime } from "@/lib/ui/datetime";
function formatDate(date: Date | null) {
  if (!date) return "-";
  return formatWibDateTime(date, { seconds: true });
}

function buildPageHref(searchParams: URLSearchParams, page: number) {
  const params = new URLSearchParams(searchParams.toString());
  params.set("page", String(page));
  return `/admin/siem/events?${params.toString()}`;
}

function SafeRawLogBlock({ value, indicators }: { value: string; indicators: InjectionIndicator[] }) {
  return (
    <div className="space-y-2">
      <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-md border border-ops-border bg-slate-950/70 p-3 font-mono text-xs leading-relaxed text-slate-100">
        {value}
      </pre>
      <div className="flex flex-wrap gap-2">
        {indicators.length === 0 ? (
          <StatusBadge tone="success" className="gap-1.5"><ShieldCheck className="size-3" />No injection indicators</StatusBadge>
        ) : indicators.map((indicator) => (
          <StatusBadge key={indicator.key} tone={indicatorTone(indicator.severity)} className="gap-1.5">
            <AlertTriangle className="size-3" />{indicator.label}
          </StatusBadge>
        ))}
      </div>
    </div>
  );
}

function EventFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
      const text = String(value).trim();
      if (text) params.set(key, text);
    }
    params.set("page", "1");
    router.push(`/admin/siem/events?${params.toString()}`);
  };

  return (
    <form onSubmit={handleSubmit} className="grid w-full gap-3 lg:grid-cols-[1.5fr_repeat(6,minmax(0,1fr))_auto]">
      <div className="relative min-w-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
        <input name="q" defaultValue={searchParams.get("q") ?? ""} placeholder="Search message, user, source..." className={`${fieldClass} w-full pl-9`} />
      </div>
      <input name="sourceIp" defaultValue={searchParams.get("sourceIp") ?? ""} placeholder="Source IP" className={`${fieldClass} w-full`} />
      <input name="category" defaultValue={searchParams.get("category") ?? ""} placeholder="Category" className={`${fieldClass} w-full`} />
      <input name="normalizedType" defaultValue={searchParams.get("normalizedType") ?? ""} placeholder="Type" className={`${fieldClass} w-full`} />
      <input name="severity" type="number" min="0" max="7" defaultValue={searchParams.get("severity") ?? ""} placeholder="Sev 0-7" className={`${fieldClass} w-full`} />
      <select name="status" defaultValue={searchParams.get("status") ?? ""} className={`${fieldClass} w-full`}>
        <option value="">Raw status</option>
        {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
      </select>
      <input name="start" type="date" defaultValue={searchParams.get("start") ?? ""} className={`${fieldClass} w-full`} />
      <div className="flex gap-2">
        <ActionButton type="submit" icon={<Filter className="size-4" />}>Filter</ActionButton>
        <ActionButton href="/admin/siem/events" variant="secondary" icon={<X className="size-4" />}>Reset</ActionButton>
      </div>
    </form>
  );
}

function PaginationControls({ data }: { data: ExplorerData }) {
  const searchParams = useSearchParams();
  if (data.totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between border-t border-ops-border px-4 py-3 text-sm text-ops-muted">
      <span>Page {data.currentPage} of {data.totalPages}</span>
      <div className="flex gap-2">
        <ActionButton href={buildPageHref(searchParams, Math.max(1, data.currentPage - 1))} variant="secondary" disabled={data.currentPage <= 1} icon={<ArrowLeft className="size-4" />}>Previous</ActionButton>
        <ActionButton href={buildPageHref(searchParams, Math.min(data.totalPages, data.currentPage + 1))} variant="secondary" disabled={data.currentPage >= data.totalPages} icon={<ArrowRight className="size-4" />}>Next</ActionButton>
      </div>
    </div>
  );
}

export default function SiemEventExplorer({ data }: { data: ExplorerData }) {
  const highRiskCount = useMemo(() => (
    data.events.reduce((count, event) => count + event.injectionIndicators.filter((indicator) => indicator.severity === "high").length, 0) +
    data.rawEvents.reduce((count, event) => count + event.injectionIndicators.filter((indicator) => indicator.severity === "high").length, 0)
  ), [data.events, data.rawEvents]);

  return (
    <div className="space-y-5">
      <DataToolbar>
        <EventFilters />
      </DataToolbar>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="ops-panel p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ops-muted">Parsed Events</p>
          <p className="mt-2 text-2xl font-bold text-ops-text">{data.totalEvents.toLocaleString("id-ID")}</p>
        </div>
        <div className="ops-panel p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ops-muted">Raw Events</p>
          <p className="mt-2 text-2xl font-bold text-ops-text">{data.totalRawEvents.toLocaleString("id-ID")}</p>
        </div>
        <div className="ops-panel p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ops-muted">High-Risk Injection Indicators</p>
          <p className="mt-2 text-2xl font-bold text-ops-text">{highRiskCount.toLocaleString("id-ID")}</p>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-ops-text">Parsed SIEM Events</h2>
          <p className="text-sm text-ops-muted">Normalized events with safe raw-log preview and Injection Inspector labels.</p>
        </div>
        <DataTableFrame>
          <DataTable>
            <DataTableHead>
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Raw Log / Inspector</th>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {data.events.length === 0 ? (
                <DataTableEmpty colSpan={5} title="No parsed SIEM events" description="Adjust filters or wait for parser worker output." />
              ) : data.events.map((event) => (
                <tr key={event.id} className="align-top transition-colors hover:bg-ops-surface">
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-ops-muted">{formatDate(event.receivedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-sm text-ops-text">{event.sourceIp}</div>
                    <div className="text-xs text-ops-muted">{event.hostname || event.sourceDisplayName || "Unknown host"}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <StatusBadge tone="info">{event.vendor || "generic"}</StatusBadge>
                      <StatusBadge tone={severityTone(event.severity)}>sev {event.severity ?? "-"}</StatusBadge>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-ops-text">{event.normalizedType || event.category || "Unclassified"}</div>
                    <div className="mt-1 text-sm text-ops-muted">{event.message}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      {event.action && <StatusBadge tone="accent">{event.action}</StatusBadge>}
                      {event.outcome && <StatusBadge tone="purple">{event.outcome}</StatusBadge>}
                      {event.username && <StatusBadge tone="neutral">user: {event.username}</StatusBadge>}
                      {event.srcIp && <StatusBadge tone="neutral">src: {event.srcIp}</StatusBadge>}
                      {event.dstIp && <StatusBadge tone="neutral">dst: {event.dstIp}</StatusBadge>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-ops-text">{event.deviceName || "Unmapped"}</div>
                    <div className="text-xs text-ops-muted">{event.siteName || "No site"}</div>
                  </td>
                  <td className="min-w-[360px] px-4 py-3">
                    <SafeRawLogBlock value={event.rawMessage ?? event.message} indicators={event.injectionIndicators} />
                  </td>
                </tr>
              ))}
            </DataTableBody>
          </DataTable>
          <PaginationControls data={data} />
        </DataTableFrame>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-ops-text">Recent Raw Ingest</h2>
          <p className="text-sm text-ops-muted">Raw rows remain escaped and non-executable in browser.</p>
        </div>
        <DataTableFrame>
          <DataTable>
            <DataTableHead>
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Raw Log / Inspector</th>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {data.rawEvents.length === 0 ? (
                <DataTableEmpty colSpan={4} title="No raw syslog events" description="Raw rows appear after receiver writes packets for mapped site sources." />
              ) : data.rawEvents.map((event) => (
                <tr key={event.id} className="align-top transition-colors hover:bg-ops-surface">
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-ops-muted">{formatDate(event.receivedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="font-mono text-sm text-ops-text">{event.sourceIp}:{event.sourcePort}</div>
                    <div className="text-xs text-ops-muted">{event.transport} · {event.rawSize} bytes</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={statusTone(event.ingestStatus)} dot>{event.ingestStatus}</StatusBadge>
                    {event.parseError && <div className="mt-2 max-w-xs text-xs text-red-200">{event.parseError}</div>}
                  </td>
                  <td className="min-w-[420px] px-4 py-3">
                    <SafeRawLogBlock value={event.rawMessage} indicators={event.injectionIndicators} />
                  </td>
                </tr>
              ))}
            </DataTableBody>
          </DataTable>
        </DataTableFrame>
      </section>
    </div>
  );
}
