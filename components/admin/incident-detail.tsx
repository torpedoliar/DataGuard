import type { getIncidentDetail } from "@/actions/incidents";
import IncidentAssignmentForm from "./incident-assignment-form";
import IncidentStatusForm from "./incident-status-form";
import IncidentUpdateForm from "./incident-update-form";

type IncidentDetailModel = NonNullable<Awaited<ReturnType<typeof getIncidentDetail>>>;

const severityClass: Record<string, string> = {
  Low: "bg-slate-500/15 text-slate-300",
  Medium: "bg-yellow-500/15 text-yellow-300",
  High: "bg-orange-500/15 text-orange-300",
  Critical: "bg-red-500/15 text-red-300",
};

const statusClass: Record<string, string> = {
  Open: "bg-blue-500/15 text-blue-300",
  "In Progress": "bg-cyan-500/15 text-cyan-300",
  Resolved: "bg-purple-500/15 text-purple-300",
  Verified: "bg-green-500/15 text-green-300",
};

function formatDate(date: Date | null) {
  return date ? date.toLocaleString("en-GB") : "-";
}

export default function IncidentDetail({
  incident,
  users,
  canAdmin,
}: {
  incident: IncidentDetailModel;
  users: { id: number; username: string }[];
  canAdmin: boolean;
}) {
  return (
    <main className="max-w-[1600px] mx-auto px-5 py-6 grid grid-cols-1 xl:grid-cols-3 gap-6">
      <section className="xl:col-span-2 space-y-6">
        <div className="glow-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-slate-400">Incident #{incident.id}</p>
              <h1 className="text-2xl font-bold text-white mt-1">{incident.title}</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${severityClass[incident.severity] ?? severityClass.Low}`}>
                {incident.severity}
              </span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass[incident.status] ?? statusClass.Open}`}>
                {incident.status}
              </span>
            </div>
          </div>
          <p className="text-slate-400 mt-4">{incident.description || "No description."}</p>
          {incident.isRecurring && <p className="mt-3 text-sm text-red-300">Recurring issue in the last 30 days.</p>}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 text-sm">
            <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-3">
              <p className="text-xs text-slate-500">Device</p>
              <p className="text-white font-medium mt-1">{incident.device.name}</p>
            </div>
            <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-3">
              <p className="text-xs text-slate-500">Assignee</p>
              <p className="text-white font-medium mt-1">{incident.assignedTo?.username ?? "Unassigned"}</p>
            </div>
            <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-3">
              <p className="text-xs text-slate-500">Due</p>
              <p className="text-white font-medium mt-1">{formatDate(incident.dueDate)}</p>
            </div>
          </div>
        </div>

        <div className="glow-card p-6">
          <h2 className="text-lg font-bold text-white mb-4">Timeline</h2>
          <div className="space-y-4">
            {incident.updates.length === 0 ? (
              <p className="text-sm text-slate-500">No updates yet.</p>
            ) : incident.updates.map((update) => (
              <div key={update.id} className="border-l border-slate-700 pl-4">
                <p className="text-sm text-white">{update.note || update.updateType.replace("_", " ")}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {update.author?.username || "System"} - {formatDate(update.createdAt)}
                </p>
                {update.previousStatus && update.newStatus && (
                  <p className="text-xs text-slate-400 mt-1">{update.previousStatus} to {update.newStatus}</p>
                )}
                {update.photoPath && (
                  <a href={update.photoPath} target="_blank" className="mt-2 inline-flex text-sm text-blue-400 hover:text-blue-300">
                    View evidence
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside className="space-y-6">
        {canAdmin && (
          <IncidentAssignmentForm
            incidentId={incident.id}
            users={users}
            currentAssigneeId={incident.assignedToId}
            currentSeverity={incident.severity}
            currentDueDate={incident.dueDate}
          />
        )}
        <IncidentStatusForm incidentId={incident.id} currentStatus={incident.status} />
        <IncidentUpdateForm incidentId={incident.id} />
      </aside>
    </main>
  );
}
