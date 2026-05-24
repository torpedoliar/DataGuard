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
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
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

export default function SiemDashboard({ stats }: { stats: SiemDashboardStats }) {
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
