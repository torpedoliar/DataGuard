import ActionButton from "@/components/ui/action-button";
import {
  DataTable,
  DataTableBody,
  DataTableEmpty,
  DataTableFrame,
  DataTableHead,
} from "@/components/ui/data-table";
import StatusBadge from "@/components/ui/status-badge";
import { getIncidentSeverityTone } from "@/lib/ui/status";
import { AlertTriangle, Bell, FileSearch, RadioTower, ScrollText, ShieldAlert } from "lucide-react";

export type SiemDashboardSnapshot = {
  capturedAt: string;
  raw24h: number;
  parsed24h: number;
  openFindings: number;
  criticalFindings: number;
  unmappedSources: number;
  pendingAlerts: number;
  failedAlerts: number;
};

export type SiemDashboardStats = {
  raw24h: number;
  parsed24h: number;
  openFindings: number;
  criticalFindings: number;
  unmappedSources: number;
  pendingAlerts: number;
  failedAlerts: number;
  latestFindings: {
    id: number;
    title: string;
    severity: "Low" | "Medium" | "High" | "Critical";
    status: "Open" | "Acknowledged" | "Resolved";
    lastSeenAt: Date;
    ruleName: string | null;
    sourceIp: string | null;
    deviceName: string | null;
  }[];
  timeseries: {
    "24h": SiemDashboardSnapshot[];
    "7d": SiemDashboardSnapshot[];
    "30d": SiemDashboardSnapshot[];
  };
};

import { formatWibDateTime } from "@/lib/ui/datetime";
function formatDate(date: Date) {
  return formatWibDateTime(date);
}

function StatCard({ label, value, detail, tone = "neutral" }: { label: string; value: number; detail: string; tone?: "neutral" | "danger" | "warning" | "info" | "success" }) {
  const toneClass = {
    neutral: "border-ops-border",
    danger: "border-red-400/30 bg-red-500/10",
    warning: "border-amber-400/30 bg-amber-500/10",
    info: "border-blue-400/30 bg-blue-500/10",
    success: "border-emerald-400/30 bg-emerald-500/10",
  }[tone];

  return (
    <div className={`rounded-xl border bg-ops-surface p-4 ${toneClass}`}>
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-ops-muted">{label}</p>
      <p className="mt-3 text-3xl font-bold text-ops-text">{value.toLocaleString("id-ID")}</p>
      <p className="mt-1 text-sm text-ops-muted">{detail}</p>
    </div>
  );
}

/**
 * A series of values to plot on the time-series line chart.
 * - `color` is a CSS color (with currentColor fallback).
 * - `values` are the y-values; x is implicit (uniformly distributed).
 */
export type TimeseriesSeries = {
  label: string;
  color: string;
  values: number[];
};

/**
 * Tiny SVG line chart used by the SIEM dashboard. Renders one path per
 * series with grid lines and min/max axis labels. Pure presentational,
 * no library — keeps the bundle small and the markup greppable.
 */
function TimeseriesChart({
  title,
  series,
  empty,
}: {
  title: string;
  series: TimeseriesSeries[];
  empty?: string;
}) {
  const width = 200;
  const height = 60;
  const padding = { top: 6, right: 4, bottom: 12, left: 4 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  // Flatten values to compute a shared y-scale. Empty arrays plot at y=0.
  const allValues = series.flatMap((s) => s.values);
  const max = allValues.length > 0 ? Math.max(...allValues, 1) : 1;
  const min = allValues.length > 0 ? Math.min(...allValues, 0) : 0;
  const range = Math.max(max - min, 1);

  const xFor = (i: number, n: number) => {
    if (n <= 1) return padding.left + innerW / 2;
    return padding.left + (i * innerW) / (n - 1);
  };
  const yFor = (v: number) => padding.top + innerH - ((v - min) / range) * innerH;

  // 4 horizontal grid lines (top, 1/3, 2/3, bottom)
  const gridYs = [0, 0.33, 0.66, 1].map((t) => padding.top + innerH * t);

  const hasData = series.some((s) => s.values.length > 0);

  return (
    <div className="ops-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-ops-muted">{title}</p>
        <div className="flex gap-3">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1 text-[10px] text-ops-muted">
              <span className="inline-block h-1.5 w-3 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      {hasData ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={`${title} time-series chart`}
        >
          {gridYs.map((y, idx) => (
            <line
              key={`grid-${idx}`}
              x1={padding.left}
              x2={padding.left + innerW}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeOpacity="0.15"
              strokeWidth="0.5"
            />
          ))}
          {series.map((s) => {
            if (s.values.length === 0) return null;
            const d = s.values
              .map((v, i) => `${i === 0 ? "M" : "L"}${xFor(i, s.values.length).toFixed(2)},${yFor(v).toFixed(2)}`)
              .join(" ");
            return (
              <path
                key={s.label}
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
          <text x={padding.left} y={height - 1} fontSize="8" fill="currentColor" opacity="0.6">
            {min}
          </text>
          <text
            x={padding.left + innerW}
            y={height - 1}
            fontSize="8"
            fill="currentColor"
            opacity="0.6"
            textAnchor="end"
          >
            {max}
          </text>
        </svg>
      ) : (
        <div className="flex h-[60px] items-center justify-center text-xs text-ops-muted">
          {empty ?? "No history yet — snapshots start after deploy."}
        </div>
      )}
    </div>
  );
}

function toSeriesValues(
  snaps: SiemDashboardSnapshot[],
  pick: (snap: SiemDashboardSnapshot) => number,
): number[] {
  return snaps.map(pick);
}

export default function SiemDashboard({ stats }: { stats: SiemDashboardStats }) {
  const ts = stats.timeseries ?? { "24h": [], "7d": [], "30d": [] };
  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Raw 24h" value={stats.raw24h} detail="UDP syslog packets received" tone="info" />
        <StatCard label="Parsed 24h" value={stats.parsed24h} detail="Active-site normalized events" tone="success" />
        <StatCard label="Open Findings" value={stats.openFindings} detail="Non-resolved detections" tone={stats.openFindings > 0 ? "warning" : "success"} />
        <StatCard label="Critical Findings" value={stats.criticalFindings} detail="Critical non-resolved findings" tone={stats.criticalFindings > 0 ? "danger" : "success"} />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="ops-panel flex items-center justify-between p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-ops-muted">Unmapped Sources</p>
            <p className="mt-2 text-2xl font-bold text-ops-text">{stats.unmappedSources.toLocaleString("id-ID")}</p>
          </div>
          <RadioTower className="size-8 text-amber-200" />
        </div>
        <div className="ops-panel flex items-center justify-between p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-ops-muted">Pending Alerts</p>
            <p className="mt-2 text-2xl font-bold text-ops-text">{stats.pendingAlerts.toLocaleString("id-ID")}</p>
          </div>
          <Bell className="size-8 text-blue-200" />
        </div>
        <div className="ops-panel flex items-center justify-between p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-ops-muted">Failed Alerts</p>
            <p className="mt-2 text-2xl font-bold text-ops-text">{stats.failedAlerts.toLocaleString("id-ID")}</p>
          </div>
          <AlertTriangle className="size-8 text-red-200" />
        </div>
      </section>

      <section className="space-y-2">
        <div>
          <h2 className="text-lg font-bold text-ops-text">Time-Series Trends</h2>
          <p className="text-sm text-ops-muted">Hourly snapshot history — the three windows share the same x-axis (oldest to newest) and a per-chart y-scale.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <TimeseriesChart
            title="Event Volume (24h)"
            series={[
              { label: "Raw", color: "#60a5fa", values: toSeriesValues(ts["24h"], (s) => s.raw24h) },
              { label: "Parsed", color: "#34d399", values: toSeriesValues(ts["24h"], (s) => s.parsed24h) },
            ]}
          />
          <TimeseriesChart
            title="Findings (7d)"
            series={[
              { label: "Open", color: "#fbbf24", values: toSeriesValues(ts["7d"], (s) => s.openFindings) },
              { label: "Critical", color: "#f87171", values: toSeriesValues(ts["7d"], (s) => s.criticalFindings) },
            ]}
          />
          <TimeseriesChart
            title="Alerts (30d)"
            series={[
              { label: "Pending", color: "#60a5fa", values: toSeriesValues(ts["30d"], (s) => s.pendingAlerts) },
              { label: "Failed", color: "#f87171", values: toSeriesValues(ts["30d"], (s) => s.failedAlerts) },
            ]}
          />
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <ActionButton href="/admin/siem/syslog" variant="secondary" icon={<ScrollText className="size-4" />}>Syslog</ActionButton>
        <ActionButton href="/admin/siem/events" variant="secondary" icon={<FileSearch className="size-4" />}>Event Explorer</ActionButton>
        <ActionButton href="/admin/siem/findings" variant="secondary" icon={<ShieldAlert className="size-4" />}>Findings</ActionButton>
        <ActionButton href="/admin/siem/sources" variant="secondary" icon={<RadioTower className="size-4" />}>Sources</ActionButton>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-ops-text">Latest Findings</h2>
          <p className="text-sm text-ops-muted">Recent detections from active-site syslog events.</p>
        </div>
        <DataTableFrame>
          <DataTable>
            <DataTableHead>
              <tr>
                <th className="px-4 py-3">Finding</th>
                <th className="px-4 py-3">Rule</th>
                <th className="px-4 py-3">Asset / Source</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Seen</th>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {stats.latestFindings.length === 0 ? (
                <DataTableEmpty colSpan={6} title="No SIEM findings" description="Rule worker findings appear here after parsed events match enabled rules." />
              ) : stats.latestFindings.map((finding) => (
                <tr key={finding.id} className="transition-colors hover:bg-ops-surface">
                  <td className="px-4 py-3 font-semibold text-ops-text">#{finding.id} {finding.title}</td>
                  <td className="px-4 py-3 text-sm text-ops-muted">{finding.ruleName ?? "Unknown rule"}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-ops-text">{finding.deviceName ?? "Unmapped"}</div>
                    <div className="text-xs text-ops-muted">{finding.sourceIp ?? "No source"}</div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge tone={getIncidentSeverityTone(finding.severity)} dot>{finding.severity}</StatusBadge></td>
                  <td className="px-4 py-3"><StatusBadge tone={finding.status === "Resolved" ? "success" : finding.status === "Acknowledged" ? "warning" : "info"}>{finding.status}</StatusBadge></td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-ops-muted">{formatDate(finding.lastSeenAt)}</td>
                </tr>
              ))}
            </DataTableBody>
          </DataTable>
        </DataTableFrame>
      </section>
    </div>
  );
}
