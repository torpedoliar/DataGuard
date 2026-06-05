"use client";

import { updateSiemSource } from "@/actions/siem-sources";
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
import { ArrowDown, ArrowUp, ArrowUpDown, Edit, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";

export type SiemSourceRow = {
  id: number;
  siteId: number | null;
  siteName: string | null;
  deviceId: number | null;
  deviceName: string | null;
  deviceIp: string | null;
  sourceIp: string;
  hostname: string | null;
  displayName: string;
  vendor: "generic" | "mikrotik" | "cisco" | "fortigate" | "linux" | "watchguard";
  product: string | null;
  parserProfile: string;
  trustLevel: "unknown" | "trusted" | "untrusted";
  enabled: boolean;
  lastSeenAt: Date | null;
  eventCount: number;
  rawRetentionDays: number | null;
  eventRetentionDays: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type SiemSourceDeviceOption = {
  id: number;
  name: string;
  ipAddress: string | null;
  assetCode: string | null;
};

type SortKey = "displayName" | "sourceIp" | "vendor" | "trustLevel" | "lastSeenAt" | "eventCount";
type SortDir = "asc" | "desc";

const fieldClass = "ops-input h-9 px-3 text-sm";
const vendors = ["generic", "mikrotik", "cisco", "fortigate", "linux", "watchguard"] as const;
const trustLevels = ["unknown", "trusted", "untrusted"] as const;

function trustTone(trustLevel: SiemSourceRow["trustLevel"]) {
  if (trustLevel === "trusted") return "success";
  if (trustLevel === "untrusted") return "danger";
  return "warning";
}

import { formatWibDateTime } from "@/lib/ui/datetime";
function formatDate(date: Date | null) {
  if (!date) return "Never";
  return formatWibDateTime(date);
}

function EditSourceModal({ source, devices, onClose }: { source: SiemSourceRow; devices: SiemSourceDeviceOption[]; onClose: () => void }) {
  const router = useRouter();
  const [state, action, isPending] = useActionState(updateSiemSource, undefined);

  useEffect(() => {
    if (state?.success) {
      router.refresh();
      onClose();
    }
  }, [state?.success, router, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-ops-border bg-ops-surface-raised shadow-xl">
        <div className="flex items-center justify-between border-b border-ops-border px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-ops-text">Map SIEM Source</h3>
            <p className="text-sm text-ops-muted">{source.sourceIp}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ops-muted hover:bg-ops-surface hover:text-ops-text" disabled={isPending}>
            <X className="size-5" />
          </button>
        </div>

        <form action={action} className="space-y-4 p-5">
          <input type="hidden" name="id" value={source.id} />
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              Display name
              <input name="displayName" defaultValue={source.displayName} required className={`${fieldClass} w-full`} />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              Hostname
              <input name="hostname" defaultValue={source.hostname ?? ""} className={`${fieldClass} w-full`} />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              Device mapping
              <select name="deviceId" defaultValue={source.deviceId ?? ""} className={`${fieldClass} w-full`}>
                <option value="">Unmapped</option>
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>{device.name}{device.ipAddress ? ` (${device.ipAddress})` : ""}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              Vendor
              <select name="vendor" defaultValue={source.vendor} className={`${fieldClass} w-full`}>
                {vendors.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              Parser profile
              <input name="parserProfile" defaultValue={source.parserProfile} required className={`${fieldClass} w-full`} />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              Trust level
              <select name="trustLevel" defaultValue={source.trustLevel} className={`${fieldClass} w-full`}>
                {trustLevels.map((level) => <option key={level} value={level}>{level}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              Enabled
              <select name="enabled" defaultValue={source.enabled ? "true" : "false"} className={`${fieldClass} w-full`}>
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              Raw retention (days)
              <input
                name="rawRetentionDays"
                type="number"
                min={1}
                max={3650}
                defaultValue={source.rawRetentionDays ?? ""}
                placeholder="Follow global"
                className={`${fieldClass} w-full`}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              Event retention (days)
              <input
                name="eventRetentionDays"
                type="number"
                min={1}
                max={3650}
                defaultValue={source.eventRetentionDays ?? ""}
                placeholder="Follow global"
                className={`${fieldClass} w-full`}
              />
            </label>
          </div>

          {state?.errors && <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{Object.values(state.errors).flat().join(" ")}</div>}
          {state?.message && !state.success && <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{state.message}</div>}

          <div className="flex justify-end gap-3 border-t border-ops-border pt-4">
            <ActionButton type="button" variant="secondary" onClick={onClose} disabled={isPending}>Cancel</ActionButton>
            <ActionButton type="submit" isPending={isPending}>Save Source</ActionButton>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SiemSourceTable({ sources, devices }: { sources: SiemSourceRow[]; devices: SiemSourceDeviceOption[] }) {
  const [editingSource, setEditingSource] = useState<SiemSourceRow | null>(null);
  const [search, setSearch] = useState("");
  const [trustFilter, setTrustFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("lastSeenAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const renderSortIcon = (column: SortKey) => {
    if (sortKey !== column) return <ArrowUpDown className="size-3.5 text-slate-600" />;
    return sortDir === "asc" ? <ArrowUp className="size-3.5 text-ops-accent" /> : <ArrowDown className="size-3.5 text-ops-accent" />;
  };

  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    return sources
      .filter((source) => {
        const matchesSearch = !query ||
          source.displayName.toLowerCase().includes(query) ||
          source.sourceIp.toLowerCase().includes(query) ||
          (source.hostname?.toLowerCase().includes(query) ?? false) ||
          (source.deviceName?.toLowerCase().includes(query) ?? false);
        const matchesTrust = !trustFilter || source.trustLevel === trustFilter;
        return matchesSearch && matchesTrust;
      })
      .sort((a, b) => {
        const aValue = sortKey === "lastSeenAt" ? a.lastSeenAt?.getTime() ?? 0 : a[sortKey];
        const bValue = sortKey === "lastSeenAt" ? b.lastSeenAt?.getTime() ?? 0 : b[sortKey];
        if (aValue < bValue) return sortDir === "asc" ? -1 : 1;
        if (aValue > bValue) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
  }, [sources, search, trustFilter, sortKey, sortDir]);

  const unmapped = sources.filter((source) => !source.deviceId).length;

  return (
    <div className="space-y-3">
      <DataToolbar>
        <div className="flex w-full flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search source, host, or mapped device..." className={`${fieldClass} w-full pl-9 pr-8`} />
              {search && <button type="button" onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ops-muted hover:text-ops-text" title="Clear search"><X className="size-3.5" /></button>}
            </div>
            <select value={trustFilter} onChange={(event) => setTrustFilter(event.target.value)} className={`${fieldClass} w-full sm:w-44`}>
              <option value="">All trust levels</option>
              {trustLevels.map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-ops-muted">
            <span>{filtered.length} of {sources.length} Sources</span>
            <StatusBadge tone={unmapped > 0 ? "warning" : "success"}>{unmapped} unmapped</StatusBadge>
          </div>
        </div>
      </DataToolbar>

      <DataTableFrame>
        <DataTable>
          <DataTableHead>
            <tr>
              <th className="px-5 py-3 text-left"><button type="button" onClick={() => handleSort("displayName")} className="inline-flex items-center gap-1.5">Source {renderSortIcon("displayName")}</button></th>
              <th className="px-5 py-3 text-left"><button type="button" onClick={() => handleSort("sourceIp")} className="inline-flex items-center gap-1.5">IP {renderSortIcon("sourceIp")}</button></th>
              <th className="px-5 py-3 text-left">Device</th>
              <th className="px-5 py-3 text-left"><button type="button" onClick={() => handleSort("vendor")} className="inline-flex items-center gap-1.5">Vendor {renderSortIcon("vendor")}</button></th>
              <th className="px-5 py-3 text-left"><button type="button" onClick={() => handleSort("trustLevel")} className="inline-flex items-center gap-1.5">Trust {renderSortIcon("trustLevel")}</button></th>
              <th className="px-5 py-3 text-left"><button type="button" onClick={() => handleSort("lastSeenAt")} className="inline-flex items-center gap-1.5">Last Seen {renderSortIcon("lastSeenAt")}</button></th>
              <th className="px-5 py-3 text-right"><button type="button" onClick={() => handleSort("eventCount")} className="inline-flex items-center gap-1.5">Events {renderSortIcon("eventCount")}</button></th>
              <th className="px-5 py-3 text-right">Retention</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </DataTableHead>
          <DataTableBody>
            {filtered.length === 0 ? (
              <DataTableEmpty colSpan={9} title={search || trustFilter ? "No SIEM sources match filters" : "No SIEM sources yet"} description="Unknown sources appear here after syslog packets arrive and unknown-source handling is enabled." />
            ) : filtered.map((source) => (
              <tr key={source.id} className="transition-colors hover:bg-ops-surface">
                <td className="px-5 py-3">
                  <div className="font-semibold text-ops-text">{source.displayName}</div>
                  <div className="text-xs text-ops-muted">{source.hostname || "No hostname"}</div>
                </td>
                <td className="whitespace-nowrap px-5 py-3 font-mono text-sm text-ops-text">{source.sourceIp}</td>
                <td className="px-5 py-3">
                  {source.deviceName ? (
                    <div>
                      <div className="font-medium text-ops-text">{source.deviceName}</div>
                      <div className="text-xs text-ops-muted">{source.deviceIp || "No device IP"}</div>
                    </div>
                  ) : <StatusBadge tone="warning">Unmapped</StatusBadge>}
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-sm text-ops-text">{source.vendor}</td>
                <td className="whitespace-nowrap px-5 py-3"><StatusBadge tone={trustTone(source.trustLevel)} dot>{source.trustLevel}</StatusBadge></td>
                <td className="whitespace-nowrap px-5 py-3 text-sm text-ops-muted">{formatDate(source.lastSeenAt)}</td>
                <td className="whitespace-nowrap px-5 py-3 text-right font-mono text-sm text-ops-text">{source.eventCount.toLocaleString("id-ID")}</td>
                <td className="whitespace-nowrap px-5 py-3 text-right text-sm text-ops-muted">
                  {source.eventRetentionDays ? `${source.eventRetentionDays}d` : "Global"}
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-right">
                  <ActionButton type="button" variant="ghost" size="icon" onClick={() => setEditingSource(source)} title="Edit source mapping">
                    <Edit className="size-4 text-blue-300" />
                  </ActionButton>
                </td>
              </tr>
            ))}
          </DataTableBody>
        </DataTable>
      </DataTableFrame>

      {editingSource && <EditSourceModal source={editingSource} devices={devices} onClose={() => setEditingSource(null)} />}
    </div>
  );
}
