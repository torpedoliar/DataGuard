import { getDashboardStats } from "@/actions/dashboard";
import ActionButton from "@/components/ui/action-button";
import StatusBadge from "@/components/ui/status-badge";
import {
  getChecklistStatusTone,
  getIncidentSeverityTone,
  getIncidentStatusTone,
} from "@/lib/ui/status";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import type { UiTone } from "@/lib/ui/status";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Grid3X3,
  QrCode,
  ShieldAlert,
} from "lucide-react";

export default async function ChecklistPage() {
  const session = await verifySession();
  if (!session) redirect("/login");

  const stats = await getDashboardStats();
  const todayIso = new Date().toISOString().split('T')[0];
  const totalDevices = stats.totalDevices;
  const totalChecked = stats.checkedToday;
  const incidentPressure = stats.incidentStats.critical + stats.incidentStats.overdue;

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-6 py-6" suppressHydrationWarning>
      {/* Top header */}
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ops-accent">Dashboard</p>
          <h1 className="mt-1 text-[40px] font-bold leading-none tracking-tight text-ops-text">
            Operations Overview
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ops-muted">
            Audit completion, incident pressure, and recent device activity for the active site.
          </p>
        </div>
        <ActionButton href="/audit/new" icon={<ClipboardCheck className="size-4" />}>
          New Audit
        </ActionButton>
      </section>

      {/* Hero */}
      <section className="rounded-2xl border border-ops-border/40 bg-ops-surface p-6 shadow-[0_4px_24px_rgba(0,0,0,0.25)]">
        <div className="flex flex-col gap-8 md:flex-row md:items-center">
          <div className="relative flex size-48 shrink-0 items-center justify-center">
            <CircularProgress value={stats.overallCompletion} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[40px] font-bold leading-none text-ops-text">{stats.overallCompletion}%</span>
              <span className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-ops-muted">Complete</span>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ops-accent">Today&apos;s Audit Progress</p>
            <h2 className="mt-2 text-[30px] font-bold leading-none text-ops-text">{stats.overallCompletion}% complete</h2>
            <p className="mt-2 text-sm text-ops-muted">
              {totalChecked} of {totalDevices} devices checked across {stats.categoryStats.length} categories.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <ActionButton href="/audit/new" icon={<ClipboardCheck className="size-4" />}>
                Continue Audit
              </ActionButton>
              <ActionButton href="/grid" variant="secondary" icon={<Grid3X3 className="size-4" />}>
                Audit Grid
              </ActionButton>
            </div>
          </div>

          <div className="grid shrink-0 grid-cols-2 gap-3 md:w-60">
            <div className="rounded-xl border border-ops-border/30 bg-ops-surface-raised p-4">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-ops-muted">Checked</p>
              <p className="mt-1 text-2xl font-bold text-ops-text">{totalChecked}</p>
            </div>
            <div className="rounded-xl border border-ops-border/30 bg-ops-surface-raised p-4">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-ops-muted">Remaining</p>
              <p className="mt-1 text-2xl font-bold text-ops-text">{Math.max(totalDevices - totalChecked, 0)}</p>
            </div>
            <div className="col-span-2 rounded-xl border border-ops-border/30 bg-ops-surface-raised p-4">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-ops-muted">Categories Active</p>
              <p className="mt-1 text-2xl font-bold text-ops-text">
                {stats.categoryStats.filter((c) => c.total > 0).length}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* KPI row */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Checked Today"
          value={totalChecked}
          description={`of ${totalDevices} total devices`}
          tone={stats.overallCompletion >= 90 ? "success" : "accent"}
          badge={stats.overallCompletion >= 90 ? "On Track" : "In Progress"}
          sparkline={stats.dailyCompletion.map((d) => d.checked)}
        />
        <KpiCard
          label="Open Incidents"
          value={stats.incidentStats.open}
          description={`${stats.incidentStats.critical} critical, ${stats.incidentStats.overdue} overdue`}
          tone={stats.incidentStats.open > 0 ? "info" : "success"}
          badge={stats.incidentStats.open > 0 ? "Attention" : "Clear"}
          sparkline={stats.incidentTrend.map((d) => d.total)}
        />
        <KpiCard
          label="Critical Pressure"
          value={incidentPressure}
          description="critical + overdue incidents"
          tone={incidentPressure > 0 ? "danger" : "success"}
          badge={incidentPressure > 0 ? "Action" : "Stable"}
          sparkline={stats.incidentTrend.map((d) => d.Critical)}
        />
        <KpiCard
          label="Total Devices"
          value={totalDevices}
          description="registered in active site"
          tone="neutral"
          badge="Registered"
        />
      </section>

      {/* Analytics */}
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="rounded-2xl border border-ops-border/40 bg-ops-surface p-6 shadow-[0_4px_24px_rgba(0,0,0,0.25)]">
          <div className="mb-4">
            <h3 className="text-[20px] font-semibold text-ops-text">Audit Progress</h3>
            <p className="text-sm text-ops-muted">Device coverage over the last 7 days</p>
          </div>
          <LineChart
            data={stats.dailyCompletion.map((d) => ({ label: formatShortDate(d.date), value: d.percentage }))}
            color="#5eead4"
          />
        </div>

        <div className="rounded-2xl border border-ops-border/40 bg-ops-surface p-6 shadow-[0_4px_24px_rgba(0,0,0,0.25)]">
          <div className="mb-4">
            <h3 className="text-[20px] font-semibold text-ops-text">Incident Pressure</h3>
            <p className="text-sm text-ops-muted">New incidents by severity over the last 7 days</p>
          </div>
          <MultiLineChart data={stats.incidentTrend} />
        </div>

        <div className="rounded-2xl border border-ops-border/40 bg-ops-surface p-6 shadow-[0_4px_24px_rgba(0,0,0,0.25)]">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[20px] font-semibold text-ops-text">Recent Activity</h3>
              <p className="text-sm text-ops-muted">Latest checklist entries</p>
            </div>
            <Activity className="size-5 text-ops-muted" />
          </div>
          <div className="max-h-[320px] overflow-y-auto pr-1">
            {stats.recentActivities.length === 0 ? (
              <div className="rounded-xl border border-dashed border-ops-border/50 p-6 text-center text-sm text-ops-muted">
                No activity recorded.
              </div>
            ) : (
              <div className="space-y-0">
                {stats.recentActivities.map((activity, idx, arr) => (
                  <div key={activity.id} className="flex gap-3">
                    <div className="flex flex-col items-center pt-1.5">
                      <span className="size-2 rounded-full bg-ops-accent" />
                      {idx !== arr.length - 1 && <span className="mt-2 h-full w-px bg-ops-border/50" />}
                    </div>
                    <div className="min-w-0 flex-1 pb-5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-ops-text">{activity.device}</p>
                        <span className="shrink-0 text-[11px] text-ops-muted">
                          {activity.date === todayIso ? activity.time : formatShortDate(activity.date)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-ops-muted">
                        {activity.user} · {activity.category}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusBadge tone={getChecklistStatusTone(activity.status)} dot>
                          {activity.status === "OK" ? "Healthy" : activity.status}
                        </StatusBadge>
                        {activity.remarks && (
                          <span className="truncate text-xs text-ops-muted">{activity.remarks}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Operations */}
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-ops-border/40 bg-ops-surface p-6 shadow-[0_4px_24px_rgba(0,0,0,0.25)]">
          <div className="mb-5">
            <h3 className="text-[20px] font-semibold text-ops-text">Daily Audit Progress by Category</h3>
            <p className="text-sm text-ops-muted">Category completion for today</p>
          </div>
          <div className="space-y-4">
            {stats.categoryStats.map((category) => (
              <CategoryRow key={category.id} category={category} />
            ))}
            {stats.categoryStats.length === 0 && (
              <div className="rounded-xl border border-dashed border-ops-border/50 p-6 text-center text-sm text-ops-muted">
                No categories configured for this site.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-ops-border/40 bg-ops-surface p-6 shadow-[0_4px_24px_rgba(0,0,0,0.25)]">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[20px] font-semibold text-ops-text">Recent Incidents</h3>
              <p className="text-sm text-ops-muted">Open issues needing attention</p>
            </div>
            <ShieldAlert className="size-5 text-ops-muted" />
          </div>
          {stats.recentIncidents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ops-border/50 p-6 text-center text-sm text-ops-muted">
              No open incidents.
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-ops-border/40 text-left text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted">
                  <th className="pb-3 font-medium">Title</th>
                  <th className="pb-3 font-medium">Severity</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium text-right">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ops-border/30">
                {stats.recentIncidents.map((incident) => (
                  <tr key={incident.id}>
                    <td className="py-3 text-sm font-medium text-ops-text">
                      <Link
                        href={`/admin/incidents/${incident.id}`}
                        className="block truncate max-w-[220px] transition-colors hover:text-ops-accent"
                      >
                        {incident.title}
                      </Link>
                    </td>
                    <td className="py-3">
                      <StatusBadge tone={getIncidentSeverityTone(incident.severity)}>{incident.severity}</StatusBadge>
                    </td>
                    <td className="py-3">
                      <StatusBadge tone={getIncidentStatusTone(incident.status)}>{incident.status}</StatusBadge>
                    </td>
                    <td className="py-3 text-right text-xs text-ops-muted">{formatDateTime(incident.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Quick actions */}
      <section className="sticky bottom-6 z-20 mt-2">
        <div className="flex flex-wrap gap-3 rounded-2xl border border-ops-border/40 bg-ops-surface p-3 shadow-[0_4px_24px_rgba(0,0,0,0.25)]">
          <QuickAction href="/audit/new" icon={<ClipboardCheck className="size-5" />} title="Start New Audit" />
          <QuickAction href="/audit/scan" icon={<QrCode className="size-5" />} title="Scan QR Code" />
          <QuickAction href="/admin/incidents" icon={<ShieldAlert className="size-5" />} title="Incident Center" />
          <QuickAction href="/grid" icon={<Grid3X3 className="size-5" />} title="Audit Grid" />
        </div>
      </section>
    </main>
  );
}

function formatShortDate(date: string) {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function formatDateTime(value: Date | string | null) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CircularProgress({ value }: { value: number }) {
  const radius = 54;
  const stroke = 10;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(Math.max(value, 0), 100);
  const offset = circumference - (pct / 100) * circumference;
  return (
    <svg width="192" height="192" viewBox="0 0 120 120" className="shrink-0 -rotate-90">
      <circle cx="60" cy="60" r={radius} stroke="#172033" strokeWidth={stroke} fill="none" />
      <circle
        cx="60"
        cy="60"
        r={radius}
        stroke="#5eead4"
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-all duration-500"
      />
    </svg>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const h = 32;
  const w = 80;
  const max = Math.max(...data, 1);
  const path = data
    .map((v, i) => {
      const x = (i / (data.length - 1 || 1)) * w;
      const y = h - (v / max) * h;
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible">
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LineChart({ data, color }: { data: { label: string; value: number }[]; color: string }) {
  const h = 160;
  const w = 300;
  const pad = { top: 10, bottom: 20 };
  const plotH = h - pad.top - pad.bottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  const path = data
    .map((d, i) => {
      const x = (i / (data.length - 1 || 1)) * w;
      const y = pad.top + plotH - (d.value / max) * plotH;
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible">
        {[0.25, 0.5, 0.75].map((r, i) => (
          <line
            key={i}
            x1={0}
            y1={pad.top + plotH * (1 - r)}
            x2={w}
            y2={pad.top + plotH * (1 - r)}
            stroke="#1e293b"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="mt-2 flex justify-between text-[11px] text-ops-muted">
        {data.map((d, i) => (
          <span key={i}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

function MultiLineChart({
  data,
}: {
  data: { date: string; Critical: number; High: number; Medium: number; Low: number; total: number }[];
}) {
  const series = [
    { key: "Critical" as const, color: "#ef4444" },
    { key: "High" as const, color: "#f59e0b" },
    { key: "Medium" as const, color: "#3b82f6" },
  ];
  const h = 160;
  const w = 300;
  const pad = { top: 10, bottom: 20 };
  const plotH = h - pad.top - pad.bottom;
  const max = Math.max(...data.map((d) => d.total), 1);

  return (
    <div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible">
        {[0.25, 0.5, 0.75].map((r, i) => (
          <line
            key={i}
            x1={0}
            y1={pad.top + plotH * (1 - r)}
            x2={w}
            y2={pad.top + plotH * (1 - r)}
            stroke="#1e293b"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {series.map((s) => {
          const path = data
            .map((d, i) => {
              const x = (i / (data.length - 1 || 1)) * w;
              const y = pad.top + plotH - (d[s.key] / max) * plotH;
              return `${i === 0 ? "M" : "L"} ${x} ${y}`;
            })
            .join(" ");
          return (
            <path
              key={s.key}
              d={path}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </svg>
      <div className="mt-2 flex justify-between text-[11px] text-ops-muted">
        {data.map((d, i) => (
          <span key={i}>{formatShortDate(d.date)}</span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs text-ops-muted">
            <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.key}
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  description,
  tone,
  badge,
  sparkline,
}: {
  label: string;
  value: ReactNode;
  description: string;
  tone: UiTone;
  badge: string;
  sparkline?: number[];
}) {
  const sparkColor =
    tone === "success" ? "#22c55e" : tone === "danger" ? "#ef4444" : tone === "warning" ? "#f59e0b" : tone === "info" ? "#3b82f6" : "#5eead4";
  return (
    <div className="flex flex-col rounded-2xl border border-ops-border/40 bg-ops-surface p-5 shadow-[0_4px_24px_rgba(0,0,0,0.25)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ops-muted">{label}</p>
          <p className="mt-2 text-[30px] font-bold leading-none text-ops-text">{value}</p>
          <p className="mt-1.5 text-xs text-ops-muted">{description}</p>
        </div>
        <StatusBadge tone={tone}>{badge}</StatusBadge>
      </div>
      {sparkline && sparkline.length > 0 && (
        <div className="mt-4 h-8">
          <Sparkline data={sparkline} color={sparkColor} />
        </div>
      )}
    </div>
  );
}

function CategoryRow({ category }: { category: { id: number; name: string; total: number; checked: number; percentage: number } }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-ops-text">{category.name}</p>
          <p className="text-xs text-ops-muted">{category.checked}/{category.total} devices checked</p>
        </div>
        <span className="text-sm font-bold text-ops-text">{category.percentage}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ops-surface-raised">
        <div
          className="h-full rounded-full bg-ops-accent transition-all"
          style={{ width: `${Math.min(category.percentage, 100)}%` }}
        />
      </div>
    </div>
  );
}

function QuickAction({ href, icon, title }: { href: string; icon: ReactNode; title: string }) {
  return (
    <Link
      href={href}
      className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-ops-border/40 bg-ops-surface-raised px-4 py-3 text-sm font-semibold text-ops-text transition-colors hover:border-ops-accent/40 hover:bg-ops-surface"
    >
      <span className="text-ops-accent">{icon}</span>
      {title}
    </Link>
  );
}
