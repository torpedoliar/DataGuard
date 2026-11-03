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
import type { CSSProperties, ReactNode } from "react";
import type { UiTone } from "@/lib/ui/status";
import {
  Activity,
  ClipboardCheck,
  Grid3X3,
  QrCode,
  ShieldAlert,
} from "lucide-react";
import { OfflineBanner } from "@/components/mobile/offline-banner";
import { BottomNav } from "@/components/mobile/bottom-nav";

export default async function ChecklistPage() {
  const session = await verifySession();
  if (!session) redirect("/login");

  const stats = await getDashboardStats();
  const todayIso = new Date().toISOString().split('T')[0];
  const totalDevices = stats.totalDevices;
  const totalChecked = stats.checkedToday;
  const incidentPressure = stats.incidentStats.critical + stats.incidentStats.overdue;

  return (
    <>
      <OfflineBanner />
      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 pb-24 md:pb-10 lg:px-8" suppressHydrationWarning>
      {/* Header: title + the page's primary actions (was a sticky bar that covered content) */}
      <section className="flex animate-enter flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-ops-text sm:text-[28px]">
            Operations overview
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ops-muted">
            Audit completion, incident pressure, and recent device activity for the active site.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton href="/audit/scan" variant="secondary" icon={<QrCode />}>
            Scan QR
          </ActionButton>
          <ActionButton href="/grid" variant="secondary" icon={<Grid3X3 />}>
            Audit grid
          </ActionButton>
          <ActionButton href="/audit/new" icon={<ClipboardCheck />}>
            {stats.overallCompletion > 0 ? "Continue audit" : "Start audit"}
          </ActionButton>
        </div>
      </section>

      {/* Hero: today's progress */}
      <section className="ops-panel animate-enter overflow-hidden">
        <div className="flex flex-col gap-6 p-5 md:flex-row md:items-center md:gap-8 md:p-6">
          <div className="relative flex size-36 shrink-0 items-center justify-center self-center md:self-auto">
            <CircularProgress value={stats.overallCompletion} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[32px] font-semibold leading-none tracking-[-0.03em] text-ops-text tabular-nums">{stats.overallCompletion}%</span>
              <span className="mt-1 text-xs text-ops-muted">complete</span>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ops-muted">Today&apos;s audit</p>
            <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-ops-text">
              <span className="tabular-nums">{totalChecked}</span>
              <span className="text-ops-subtle"> / </span>
              <span className="tabular-nums">{totalDevices}</span> devices checked
            </h2>
            <p className="mt-1 text-sm text-ops-muted">
              Across {stats.categoryStats.length} {stats.categoryStats.length === 1 ? "category" : "categories"} in the active site.
            </p>
            <div className="mt-4 h-1.5 max-w-md overflow-hidden rounded-full bg-ops-surface-raised">
              <div
                className="h-full rounded-full bg-ops-accent transition-[width] duration-700 ease-out"
                style={{ width: `${Math.min(stats.overallCompletion, 100)}%` }}
              />
            </div>
          </div>

          <dl className="grid shrink-0 grid-cols-3 divide-x divide-ops-border overflow-hidden rounded-lg border border-ops-border md:w-80">
            <HeroStat label="Checked" value={totalChecked} />
            <HeroStat label="Remaining" value={Math.max(totalDevices - totalChecked, 0)} />
            <HeroStat label="Categories" value={stats.categoryStats.filter((c) => c.total > 0).length} />
          </dl>
        </div>
      </section>

      {/* KPI row */}
      <section className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          index={0}
          label="Checked today"
          value={totalChecked}
          description={`of ${totalDevices} total devices`}
          tone={stats.overallCompletion >= 90 ? "success" : "accent"}
          badge={stats.overallCompletion >= 90 ? "On track" : "In progress"}
          sparkline={stats.dailyCompletion.map((d) => d.checked)}
        />
        <KpiCard
          index={1}
          label="Open incidents"
          value={stats.incidentStats.open}
          description={`${stats.incidentStats.critical} critical, ${stats.incidentStats.overdue} overdue`}
          tone={stats.incidentStats.open > 0 ? "info" : "success"}
          badge={stats.incidentStats.open > 0 ? "Attention" : "Clear"}
          sparkline={stats.incidentTrend.map((d) => d.total)}
        />
        <KpiCard
          index={2}
          label="Critical pressure"
          value={incidentPressure}
          description="critical + overdue incidents"
          tone={incidentPressure > 0 ? "danger" : "success"}
          badge={incidentPressure > 0 ? "Action" : "Stable"}
          sparkline={stats.incidentTrend.map((d) => d.Critical)}
        />
        <KpiCard
          index={3}
          label="Total devices"
          value={totalDevices}
          description="registered in active site"
          tone="neutral"
          badge="Registered"
        />
      </section>

      {/* Analytics */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="ops-panel p-5">
          <div className="mb-4">
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Audit progress</h3>
            <p className="mt-0.5 text-[13px] text-ops-muted">Device coverage over the last 7 days</p>
          </div>
          <LineChart
            data={stats.dailyCompletion.map((d) => ({ label: formatShortDate(d.date), value: d.percentage }))}
            color="var(--color-ops-accent)"
          />
        </div>

        <div className="ops-panel p-5">
          <div className="mb-4">
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Incident pressure</h3>
            <p className="mt-0.5 text-[13px] text-ops-muted">New incidents by severity over the last 7 days</p>
          </div>
          <MultiLineChart data={stats.incidentTrend} />
        </div>

        <div className="ops-panel p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Recent activity</h3>
              <p className="mt-0.5 text-[13px] text-ops-muted">Latest checklist entries</p>
            </div>
            <Activity className="size-4 text-ops-subtle" />
          </div>
          <div className="max-h-[320px] overflow-y-auto pr-1">
            {stats.recentActivities.length === 0 ? (
              <div className="rounded-lg border border-dashed border-ops-border px-6 py-10 text-center text-sm text-ops-muted">
                No activity recorded.
              </div>
            ) : (
              <div className="space-y-0">
                {stats.recentActivities.map((activity, idx, arr) => (
                  <div key={activity.id} className="flex gap-3">
                    <div className="flex flex-col items-center pt-1.5">
                      <span className="size-2 rounded-full border-2 border-ops-accent bg-ops-surface" />
                      {idx !== arr.length - 1 && <span className="mt-1.5 h-full w-px bg-ops-border" />}
                    </div>
                    <div className="min-w-0 flex-1 pb-5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-medium text-ops-text">{activity.device}</p>
                        <span className="shrink-0 text-xs tabular-nums text-ops-subtle">
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
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="ops-panel p-5">
          <div className="mb-5">
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Progress by category</h3>
            <p className="mt-0.5 text-[13px] text-ops-muted">Category completion for today</p>
          </div>
          <div className="space-y-4">
            {stats.categoryStats.map((category) => (
              <CategoryRow key={category.id} category={category} />
            ))}
            {stats.categoryStats.length === 0 && (
              <div className="rounded-lg border border-dashed border-ops-border px-6 py-10 text-center text-sm text-ops-muted">
                No categories configured for this site.
              </div>
            )}
          </div>
        </div>

        <div className="ops-panel p-5">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Recent incidents</h3>
              <p className="mt-0.5 text-[13px] text-ops-muted">Open issues needing attention</p>
            </div>
            <ShieldAlert className="size-4 text-ops-subtle" />
          </div>
          {stats.recentIncidents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-ops-border px-6 py-10 text-center text-sm text-ops-muted">
              No open incidents.
            </div>
          ) : (
            <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse">
              <thead className="bg-transparent">
                <tr className="border-b border-ops-border text-left text-xs text-ops-muted">
                  <th className="pb-3 font-medium">Title</th>
                  <th className="pb-3 font-medium">Severity</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium text-right">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ops-border bg-transparent">
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
                    <td className="py-3 text-right text-xs tabular-nums text-ops-muted">{formatDateTime(incident.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </section>

    </main>
    <BottomNav />
    </>
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
  const radius = 52;
  const stroke = 8;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(Math.max(value, 0), 100);
  const offset = circumference - (pct / 100) * circumference;
  return (
    <svg width="144" height="144" viewBox="0 0 120 120" className="shrink-0 -rotate-90">
      <circle cx="60" cy="60" r={radius} stroke="var(--color-ops-surface-raised)" strokeWidth={stroke} fill="none" />
      <circle
        cx="60"
        cy="60"
        r={radius}
        stroke="var(--color-ops-accent)"
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-[stroke-dashoffset] duration-700 ease-out"
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
            stroke="var(--color-ops-border)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
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
      <div className="mt-2 flex justify-between text-[11px] tabular-nums text-ops-subtle">
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
    { key: "Critical" as const, color: "var(--color-ops-danger)" },
    { key: "High" as const, color: "var(--color-ops-orange)" },
    { key: "Medium" as const, color: "var(--color-ops-warning)" },
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
            stroke="var(--color-ops-border)"
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
      <div className="mt-2 flex justify-between text-[11px] tabular-nums text-ops-subtle">
        {data.map((d, i) => (
          <span key={i}>{formatShortDate(d.date)}</span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs text-ops-muted">
            <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: s.color }} />
            {s.key}
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiCard({
  index,
  label,
  value,
  description,
  tone,
  badge,
  sparkline,
}: {
  index: number;
  label: string;
  value: ReactNode;
  description: string;
  tone: UiTone;
  badge: string;
  sparkline?: number[];
}) {
  const sparkColor =
    tone === "success"
      ? "var(--color-ops-success)"
      : tone === "danger"
        ? "var(--color-ops-danger)"
        : tone === "warning"
          ? "var(--color-ops-warning)"
          : tone === "info"
            ? "var(--color-ops-info)"
            : "var(--color-ops-accent)";
  return (
    <div className="ops-panel flex flex-col p-4" style={{ "--i": index } as CSSProperties}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-ops-muted">{label}</p>
        <StatusBadge tone={tone} dot>{badge}</StatusBadge>
      </div>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[28px] font-semibold leading-none tracking-[-0.03em] text-ops-text tabular-nums">{value}</p>
          <p className="mt-2 text-xs text-ops-muted">{description}</p>
        </div>
        {sparkline && sparkline.length > 1 && (
          <div className="h-8 w-20 shrink-0">
            <Sparkline data={sparkline} color={sparkColor} />
          </div>
        )}
      </div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-ops-surface-raised/50 px-3 py-3">
      <dt className="text-xs text-ops-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tracking-[-0.02em] text-ops-text tabular-nums">{value}</dd>
    </div>
  );
}

function CategoryRow({ category }: { category: { id: number; name: string; total: number; checked: number; percentage: number } }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ops-text">{category.name}</p>
          <p className="text-xs tabular-nums text-ops-muted">{category.checked}/{category.total} devices checked</p>
        </div>
        <span className="text-sm font-medium tabular-nums text-ops-text">{category.percentage}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ops-surface-raised">
        <div
          className="h-full rounded-full bg-ops-accent transition-[width] duration-700 ease-out"
          style={{ width: `${Math.min(category.percentage, 100)}%` }}
        />
      </div>
    </div>
  );
}
