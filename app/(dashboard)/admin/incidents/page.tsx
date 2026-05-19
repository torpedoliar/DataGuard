import { getIncidentStats, getIncidents, type IncidentListFilters } from "@/actions/incidents";
import IncidentTable from "@/components/admin/incident-table";
import { incidentSeverities, incidentStatuses, type IncidentSeverity, type IncidentStatus } from "@/lib/incidents";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";

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
    <main className="max-w-[1600px] mx-auto px-5 py-6 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white font-display">Incident Center</h1>
          <p className="text-sm text-slate-400 mt-0.5">Assigned remediation for checklist Warning and Error items.</p>
        </div>
        <form className="flex flex-wrap items-center gap-2" action="/admin/incidents">
          <select name="status" defaultValue={filters.status ?? ""} className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-white">
            <option value="">All status</option>
            {incidentStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select name="severity" defaultValue={filters.severity ?? ""} className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-white">
            <option value="">All severity</option>
            {incidentSeverities.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
          </select>
          <select name="due" defaultValue={filters.due ?? ""} className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-white">
            <option value="">Any due date</option>
            <option value="today">Due today</option>
            <option value="overdue">Overdue</option>
          </select>
          <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">
            Filter
          </button>
        </form>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glow-card p-4">
          <p className="text-xs text-slate-400">Open</p>
          <p className="text-3xl font-bold text-white">{stats.open}</p>
        </div>
        <div className="glow-card p-4">
          <p className="text-xs text-slate-400">Critical</p>
          <p className="text-3xl font-bold text-red-300">{stats.critical}</p>
        </div>
        <div className="glow-card p-4">
          <p className="text-xs text-slate-400">Due Today</p>
          <p className="text-3xl font-bold text-yellow-300">{stats.dueToday}</p>
        </div>
        <div className="glow-card p-4">
          <p className="text-xs text-slate-400">Overdue</p>
          <p className="text-3xl font-bold text-orange-300">{stats.overdue}</p>
        </div>
      </div>

      <IncidentTable incidents={rows} />
    </main>
  );
}
