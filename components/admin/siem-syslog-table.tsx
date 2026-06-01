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
import { getSyslogFacilityLabel, getSyslogSeverityLabel, getSyslogSeverityTone } from "@/lib/siem/syslog-labels";
import { ArrowLeft, ArrowRight, Filter, Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent } from "react";

type SyslogMessageRow = {
  id: number;
  receivedAt: Date;
  eventTime: Date | null;
  sourceIp: string;
  hostname: string | null;
  facility: number | null;
  severity: number | null;
  priority: number | null;
  appName: string | null;
  program: string | null;
  message: string;
  deviceId: number | null;
  deviceName: string | null;
  siteName: string | null;
  sourceDisplayName: string | null;
  vendor: "generic" | "mikrotik" | "cisco" | "fortigate" | "linux" | null;
  category: string | null;
  normalizedType: string | null;
};

type DeviceOption = {
  id: number;
  name: string;
  ipAddress: string | null;
  assetCode: string | null;
};

type SyslogData = {
  messages: SyslogMessageRow[];
  devices: DeviceOption[];
  totalMessages: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
};

const fieldClass = "ops-input h-9 px-3 text-sm";

function formatDate(date: Date | null) {
  if (!date) return "-";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(date));
}

function buildPageHref(searchParams: URLSearchParams, page: number) {
  const params = new URLSearchParams(searchParams.toString());
  params.set("page", String(page));
  return `/admin/siem/syslog?${params.toString()}`;
}

function SyslogFilters({ devices }: { devices: DeviceOption[] }) {
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
    router.push(`/admin/siem/syslog?${params.toString()}`);
  };

  return (
    <form onSubmit={handleSubmit} className="grid w-full gap-3 xl:grid-cols-[1.5fr_1.2fr_repeat(5,minmax(0,1fr))_auto]">
      <div className="relative min-w-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
        <input name="q" defaultValue={searchParams.get("q") ?? ""} placeholder="Search message, program, host..." className={`${fieldClass} w-full pl-9`} />
      </div>
      <select name="deviceId" defaultValue={searchParams.get("deviceId") ?? ""} className={`${fieldClass} w-full`}>
        <option value="">All devices</option>
        {devices.map((device) => <option key={device.id} value={device.id}>{device.name}{device.ipAddress ? ` (${device.ipAddress})` : ""}</option>)}
      </select>
      <input name="sourceIp" defaultValue={searchParams.get("sourceIp") ?? ""} placeholder="Source IP" className={`${fieldClass} w-full`} />
      <input name="severity" type="number" min="0" max="7" defaultValue={searchParams.get("severity") ?? ""} placeholder="Sev 0-7" className={`${fieldClass} w-full`} />
      <input name="facility" type="number" min="0" max="23" defaultValue={searchParams.get("facility") ?? ""} placeholder="Facility" className={`${fieldClass} w-full`} />
      <input name="start" type="date" defaultValue={searchParams.get("start") ?? ""} className={`${fieldClass} w-full`} />
      <input name="end" type="date" defaultValue={searchParams.get("end") ?? ""} className={`${fieldClass} w-full`} />
      <div className="flex gap-2">
        <ActionButton type="submit" icon={<Filter className="size-4" />}>Filter</ActionButton>
        <ActionButton href="/admin/siem/syslog" variant="secondary" icon={<X className="size-4" />}>Reset</ActionButton>
      </div>
    </form>
  );
}

function PaginationControls({ data }: { data: SyslogData }) {
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

export default function SiemSyslogTable({ data }: { data: SyslogData }) {
  return (
    <div className="space-y-5">
      <DataToolbar>
        <SyslogFilters devices={data.devices} />
      </DataToolbar>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="ops-panel p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ops-muted">Messages</p>
          <p className="mt-2 text-2xl font-bold text-ops-text">{data.totalMessages.toLocaleString("id-ID")}</p>
        </div>
        <div className="ops-panel p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ops-muted">Devices</p>
          <p className="mt-2 text-2xl font-bold text-ops-text">{data.devices.length.toLocaleString("id-ID")}</p>
        </div>
        <div className="ops-panel p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ops-muted">Page Size</p>
          <p className="mt-2 text-2xl font-bold text-ops-text">{data.pageSize.toLocaleString("id-ID")}</p>
        </div>
      </section>

      <DataTableFrame>
        <DataTable>
          <DataTableHead>
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Device</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Facility</th>
              <th className="px-4 py-3">Message</th>
            </tr>
          </DataTableHead>
          <DataTableBody>
            {data.messages.length === 0 ? (
              <DataTableEmpty colSpan={6} title="No syslog messages" description="Parsed syslog appears after receiver and parser workers process device packets." />
            ) : data.messages.map((message) => (
              <tr key={message.id} className="align-top transition-colors hover:bg-ops-surface">
                <td className="whitespace-nowrap px-4 py-3 text-sm text-ops-muted">{formatDate(message.receivedAt)}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-ops-text">{message.deviceName ?? "Unmapped device"}</div>
                  <div className="text-xs text-ops-muted">{message.siteName ?? "No site"}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-mono text-sm text-ops-text">{message.sourceIp}</div>
                  <div className="text-xs text-ops-muted">{message.hostname || message.sourceDisplayName || message.vendor || "Unknown source"}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge tone={getSyslogSeverityTone(message.severity)} dot>{message.severity ?? "-"} {getSyslogSeverityLabel(message.severity)}</StatusBadge>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge tone="neutral">{message.facility ?? "-"} {getSyslogFacilityLabel(message.facility)}</StatusBadge>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-ops-text">{message.normalizedType || message.category || message.program || message.appName || "Syslog"}</div>
                  <pre className="mt-1 max-w-3xl whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-ops-muted">{message.message}</pre>
                </td>
              </tr>
            ))}
          </DataTableBody>
        </DataTable>
        <PaginationControls data={data} />
      </DataTableFrame>
    </div>
  );
}
