import Link from "next/link";
import type { getIncidentDetail } from "@/actions/incidents";
import PageHeader from "@/components/ui/page-header";
import StatsCard from "@/components/ui/stats-card";
import StatusBadge from "@/components/ui/status-badge";
import { getIncidentSeverityTone, getIncidentStatusTone } from "@/lib/ui/status";
import IncidentAssignmentForm from "./incident-assignment-form";
import IncidentStatusForm from "./incident-status-form";
import IncidentUpdateForm from "./incident-update-form";

type IncidentDetailModel = NonNullable<Awaited<ReturnType<typeof getIncidentDetail>>>;

function formatDate(date: Date | null) {
  return date ? date.toLocaleString("en-GB") : "-";
}

export default function IncidentDetail({
  incident,
  users,
  canAdmin,
  isAssignee,
}: {
  incident: IncidentDetailModel;
  users: { id: number; username: string }[];
  canAdmin: boolean;
  isAssignee: boolean;
}) {
  return (
    <main className="mx-auto grid w-full max-w-[1600px] grid-cols-1 gap-5 px-4 py-5 lg:px-6 xl:grid-cols-3">
      <section className="space-y-5 xl:col-span-2">
        <PageHeader
          eyebrow={`Resolve / Incident #${incident.id}`}
          title={incident.title}
          description={incident.description || "No description provided."}
          actions={
            <Link href="/admin/incidents" className="text-sm font-semibold text-[#b7f5e4] hover:text-ops-accent">
              Back to incidents
            </Link>
          }
        />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <StatsCard label="Device" value={incident.device.name} tone="neutral" meta="Affected asset" />
          <StatsCard label="Assignee" value={incident.assignedTo?.username ?? "Unassigned"} tone="accent" meta="Current owner" />
          <StatsCard label="Due" value={formatDate(incident.dueDate)} tone="warning" meta="Resolution target" />
        </div>

        <section className="ops-panel p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-ops-text">Incident Summary</h2>
              <p className="text-sm text-ops-muted">Current workflow state and severity.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={getIncidentSeverityTone(incident.severity)} dot>{incident.severity}</StatusBadge>
              <StatusBadge tone={getIncidentStatusTone(incident.status)}>{incident.status}</StatusBadge>
            </div>
          </div>
          {incident.isRecurring && (
            <div className="rounded-md border border-red-400/25 bg-red-400/10 px-3 py-2 text-sm font-medium text-red-200">
              Recurring issue in the last 30 days.
            </div>
          )}
        </section>

        <section className="ops-panel p-5">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-ops-text">Timeline</h2>
            <p className="text-sm text-ops-muted">Evidence and workflow updates.</p>
          </div>
          <div className="space-y-4">
            {incident.updates.length === 0 ? (
              <div className="rounded-md border border-dashed border-ops-border p-6 text-center text-sm text-ops-muted">
                No updates yet.
              </div>
            ) : incident.updates.map((update) => (
              <div key={update.id} className="border-l border-ops-border pl-4">
                <p className="text-sm font-semibold text-ops-text">{update.note || update.updateType.replace("_", " ")}</p>
                <p className="mt-1 text-xs text-ops-muted">
                  {update.author?.username || "System"} | {formatDate(update.createdAt)}
                </p>
                {update.previousStatus && update.newStatus && (
                  <p className="mt-1 text-xs text-slate-400">{update.previousStatus} to {update.newStatus}</p>
                )}
                {update.photoPath && (
                  <a href={update.photoPath} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex text-sm font-semibold text-[#b7f5e4] hover:text-ops-accent">
                    View evidence
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      </section>

      <aside className="space-y-5">
        {canAdmin && (
          <IncidentAssignmentForm
            incidentId={incident.id}
            users={users}
            currentAssigneeId={incident.assignedToId}
            currentSeverity={incident.severity}
            currentDueDate={incident.dueDate}
          />
        )}
        <IncidentStatusForm incidentId={incident.id} currentStatus={incident.status} isAdmin={canAdmin} isAssignee={isAssignee} />
        <IncidentUpdateForm incidentId={incident.id} />
      </aside>
    </main>
  );
}
