import { getIncidentStats, getIncidents, type IncidentListFilters } from "@/actions/incidents";
import IncidentTable from "@/components/admin/incident-table";
import ActionButton from "@/components/ui/action-button";
import DataToolbar from "@/components/ui/data-toolbar";
import PageHeader from "@/components/ui/page-header";
import StatsCard from "@/components/ui/stats-card";
import { incidentSeverities, incidentStatuses, type IncidentSeverity, type IncidentStatus } from "@/lib/incidents";
import { verifySession } from "@/lib/session";
import { AlertTriangle, CalendarClock, CircleAlert, Filter, ShieldAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

function parseStatus(value: string | string[] | undefined): IncidentStatus | undefined {
  return typeof value === "string" && incidentStatuses.includes(value as IncidentStatus)
    ? value as IncidentStatus
    : undefined;
}

function parseSeverity(value: string | string[] | undefined): IncidentSeverity | undefined {
  return typeof value === "string" && incidentSeverities.includes(value as IncidentSeverity)
    ? value as IncidentSeverity
    : undefined;
}

function parseDue(value: string | string[] | undefined): IncidentListFilters["due"] {
  return value === "overdue" || value === "today" ? value : undefined;
}

export default async function IncidentListPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await verifySession();
  if (!session) redirect("/login");
  if (!session.activeSiteId) redirect("/select-site");

  // Activate the next-intl request locale for this server component.
  const { getLocale } = await import("next-intl/server");
  const locale = await getLocale();
  setRequestLocale(locale);
  const t = await getTranslations("Incidents");

  const params = await searchParams;
  const filters: IncidentListFilters = {
    status: parseStatus(params.status),
    severity: parseSeverity(params.severity),
    due: parseDue(params.due),
  };

  const [stats, rows] = await Promise.all([
    getIncidentStats(),
    getIncidents(filters),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        eyebrow="Resolve / Incidents"
        title="Incident Center"
        description="Assigned remediation queue for checklist Warning and Error items."
      />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard label="Open" value={stats.open} tone="info" icon={<CircleAlert className="size-5" />} />
        <StatsCard label="Critical" value={stats.critical} tone="danger" icon={<ShieldAlert className="size-5" />} />
        <StatsCard label="Due Today" value={stats.dueToday} tone="warning" icon={<CalendarClock className="size-5" />} />
        <StatsCard label="Overdue" value={stats.overdue} tone="orange" icon={<AlertTriangle className="size-5" />} />
      </section>

      <DataToolbar>
        <form className="flex w-full flex-wrap items-center gap-2" action="/admin/incidents">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-ops-muted">
            <Filter className="size-4" />
            Filters
          </div>
          <select name="status" defaultValue={filters.status ?? ""} className="ops-input h-9 min-w-36 px-3 text-sm">
            <option value="">All status</option>
            {incidentStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select name="severity" defaultValue={filters.severity ?? ""} className="ops-input h-9 min-w-36 px-3 text-sm">
            <option value="">All severity</option>
            {incidentSeverities.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
          </select>
          <select name="due" defaultValue={filters.due ?? ""} className="ops-input h-9 min-w-36 px-3 text-sm">
            <option value="">Any due date</option>
            <option value="today">Due today</option>
            <option value="overdue">Overdue</option>
          </select>
          <ActionButton type="submit" size="sm">
            Filter
          </ActionButton>
          {(filters.status || filters.severity || filters.due) && (
            <ActionButton href="/admin/incidents" variant="ghost" size="sm">
              Reset
            </ActionButton>
          )}
        </form>
      </DataToolbar>

      <IncidentTable incidents={rows} />
    </main>
  );
}
