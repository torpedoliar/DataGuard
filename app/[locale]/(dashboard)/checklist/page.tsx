import { getDashboardStats } from "@/actions/dashboard";
import ActionButton from "@/components/ui/action-button";
import PageHeader from "@/components/ui/page-header";
import StatsCard from "@/components/ui/stats-card";
import StatusBadge from "@/components/ui/status-badge";
import { getChecklistStatusTone } from "@/lib/ui/status";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    ClipboardCheck,
    FileText,
    Gauge,
    Grid3X3,
    QrCode,
    ShieldAlert,
} from "lucide-react";

export default async function ChecklistPage() {
    const session = await verifySession();
    if (!session) redirect("/login");

    const stats = await getDashboardStats();
    const today = new Date();
    const formattedDate = today.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const formattedTime = today.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
    const totalDevices = stats.totalDevices;
    const totalChecked = stats.checkedToday;
    const incidentPressure = stats.incidentStats.critical + stats.incidentStats.overdue;

    return (
        <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-6" suppressHydrationWarning>
            <PageHeader
                eyebrow="Operate / Dashboard"
                title="Operations Overview"
                description="Audit completion, incident pressure, and recent device activity for the active site."
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="rounded-md border border-ops-border bg-ops-surface px-3 py-2 text-xs font-medium text-ops-muted">
                            {formattedDate} | {formattedTime}
                        </div>
                        <ActionButton href="/audit/new" icon={<ClipboardCheck className="size-4" />}>
                            New Audit
                        </ActionButton>
                    </div>
                }
            />

            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatsCard
                    label="Completion"
                    value={`${stats.overallCompletion}%`}
                    tone="accent"
                    icon={<Gauge className="size-5" />}
                    meta={
                        <div className="h-1.5 overflow-hidden rounded-full bg-ops-bg">
                            <div className="h-full rounded-full bg-ops-accent" style={{ width: `${stats.overallCompletion}%` }} />
                        </div>
                    }
                />
                <StatsCard
                    label="Checked Today"
                    value={totalChecked}
                    tone="success"
                    icon={<CheckCircle2 className="size-5" />}
                    meta={`${totalDevices} total devices`}
                />
                <StatsCard
                    label="Open Incidents"
                    value={stats.incidentStats.open}
                    tone={stats.incidentStats.open > 0 ? "warning" : "success"}
                    icon={<ShieldAlert className="size-5" />}
                    meta={`${stats.incidentStats.critical} critical`}
                />
                <StatsCard
                    label="Critical Pressure"
                    value={incidentPressure}
                    tone={incidentPressure > 0 ? "danger" : "neutral"}
                    icon={<AlertTriangle className="size-5" />}
                    meta={`${stats.incidentStats.overdue} overdue`}
                />
            </section>

            <section className="grid grid-cols-1 gap-5 xl:grid-cols-12">
                <div className="ops-panel p-5 xl:col-span-5">
                    <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-bold text-ops-text">Daily Audit Progress</h2>
                            <p className="text-sm text-ops-muted">Category completion for today.</p>
                        </div>
                        <StatusBadge tone={stats.overallCompletion >= 90 ? "success" : "accent"} dot>
                            {stats.overallCompletion}% total
                        </StatusBadge>
                    </div>
                    <div className="space-y-3">
                        {stats.categoryStats.map((category) => (
                            <div key={category.id} className="rounded-md border border-ops-border bg-ops-surface p-3">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-ops-text">{category.name}</p>
                                        <p className="text-xs text-ops-muted">{category.checked}/{category.total} devices checked</p>
                                    </div>
                                    <span className="font-mono text-sm font-bold text-ops-text">{category.percentage}%</span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-ops-bg">
                                    <div
                                        className="h-full rounded-full bg-ops-accent"
                                        style={{ width: `${Math.min(category.percentage, 100)}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                        {stats.categoryStats.length === 0 && (
                            <div className="rounded-md border border-dashed border-ops-border p-6 text-center text-sm text-ops-muted">
                                No categories configured for this site.
                            </div>
                        )}
                    </div>
                </div>

                <div className="ops-panel p-5 xl:col-span-3">
                    <div className="mb-4">
                        <h2 className="text-lg font-bold text-ops-text">Incident Pressure</h2>
                        <p className="text-sm text-ops-muted">Open work that needs operational attention.</p>
                    </div>
                    <div className="space-y-3">
                        <IncidentPressureRow label="Open" value={stats.incidentStats.open} tone="info" />
                        <IncidentPressureRow label="Critical" value={stats.incidentStats.critical} tone="danger" />
                        <IncidentPressureRow label="Overdue" value={stats.incidentStats.overdue} tone="orange" />
                    </div>
                    <ActionButton href="/admin/incidents" variant="secondary" className="mt-5 w-full">
                        Open Incident Center
                    </ActionButton>
                </div>

                <div className="ops-panel flex min-h-[360px] flex-col p-5 xl:col-span-4">
                    <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-bold text-ops-text">Recent Activity</h2>
                            <p className="text-sm text-ops-muted">Latest checklist entries across devices.</p>
                        </div>
                        <Activity className="size-5 text-ops-muted" />
                    </div>
                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                        {stats.recentActivities.length === 0 ? (
                            <div className="rounded-md border border-dashed border-ops-border p-6 text-center text-sm text-ops-muted">
                                No activity recorded today.
                            </div>
                        ) : (
                            stats.recentActivities.map((activity) => (
                                <div key={activity.id} className="flex gap-3">
                                    <div className="flex flex-col items-center pt-1">
                                        <span className="size-2 rounded-full bg-ops-accent" />
                                        <span className="mt-2 h-full w-px bg-ops-border" />
                                    </div>
                                    <div className="min-w-0 flex-1 pb-1">
                                        <div className="flex items-start justify-between gap-2">
                                            <p className="truncate text-sm font-semibold text-ops-text">{activity.device}</p>
                                            <span className="shrink-0 font-mono text-[11px] text-ops-muted">{activity.time}</span>
                                        </div>
                                        <p className="mt-0.5 text-xs text-ops-muted">
                                            {activity.user} | {activity.category}
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
                            ))
                        )}
                    </div>
                </div>
            </section>

            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <QuickAction href="/audit/new" icon={<ClipboardCheck className="size-5" />} title="Full Audit" description="Run checklist by category" />
                <QuickAction href="/audit/scan" icon={<QrCode className="size-5" />} title="QR Scanner" description="Single-device audit" />
                <QuickAction href="/admin/incidents" icon={<ShieldAlert className="size-5" />} title="Incidents" description="Resolve open issues" />
                <QuickAction href="/grid" icon={<Grid3X3 className="size-5" />} title="Audit Grid" description="Review device history" />
                <QuickAction href="/report" icon={<FileText className="size-5" />} title="Reports" description="Compliance evidence" />
            </section>
        </main>
    );
}

function IncidentPressureRow({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone: "info" | "danger" | "orange";
}) {
    return (
        <div className="flex items-center justify-between rounded-md border border-ops-border bg-ops-surface px-3 py-2.5">
            <span className="text-sm font-medium text-ops-muted">{label}</span>
            <StatusBadge tone={tone}>{value}</StatusBadge>
        </div>
    );
}

function QuickAction({
    href,
    icon,
    title,
    description,
}: {
    href: string;
    icon: ReactNode;
    title: string;
    description: string;
}) {
    return (
        <Link
            href={href}
            className="ops-panel flex items-center gap-3 p-4 transition-colors hover:border-ops-accent/45 hover:bg-ops-surface"
        >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-ops-accent/12 text-[#b7f5e4]">
                {icon}
            </div>
            <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ops-text">{title}</p>
                <p className="truncate text-xs text-ops-muted">{description}</p>
            </div>
        </Link>
    );
}
