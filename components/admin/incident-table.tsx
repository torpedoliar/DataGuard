import Link from "next/link";
import {
  DataTable,
  DataTableBody,
  DataTableEmpty,
  DataTableFrame,
  DataTableHead,
} from "@/components/ui/data-table";
import StatusBadge from "@/components/ui/status-badge";
import { getIncidentSeverityTone, getIncidentStatusTone, type UiTone } from "@/lib/ui/status";

type IncidentRow = {
  id: number;
  title: string;
  severity: string;
  status: string;
  dueDate: Date | null;
  deviceName: string;
  assignee: string | null;
  isRecurring: boolean;
};

function formatDueDate(date: Date | null) {
  if (!date) return "-";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDueTone(date: Date | null, status: string): UiTone {
  if (!date || status === "Verified") return "neutral";
  const due = new Date(date).getTime();
  const now = Date.now();
  if (due < now) return "danger";
  if (new Date(date).toDateString() === new Date().toDateString()) return "warning";
  return "neutral";
}

export default function IncidentTable({ incidents }: { incidents: IncidentRow[] }) {
  return (
    <DataTableFrame>
      <DataTable className="whitespace-nowrap">
        <DataTableHead>
          <tr>
            <th className="px-4 py-3">Incident</th>
            <th className="px-4 py-3">Device</th>
            <th className="px-4 py-3">Severity</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Assignee</th>
            <th className="px-4 py-3">Due</th>
            <th className="px-4 py-3 text-right">Action</th>
          </tr>
        </DataTableHead>
        <DataTableBody>
          {incidents.length === 0 ? (
            <DataTableEmpty
              colSpan={7}
              title="No incidents found"
              description="Change filters or wait for checklist Warning and Error items to create incidents."
            />
          ) : incidents.map((incident) => (
            <tr key={incident.id} className="transition-colors hover:bg-ops-surface">
              <td className="px-4 py-3">
                <div className="font-semibold text-ops-text">#{incident.id} {incident.title}</div>
                {incident.isRecurring && (
                  <div className="mt-1 text-xs font-medium text-red-300">Recurring issue</div>
                )}
              </td>
              <td className="px-4 py-3 text-slate-300">{incident.deviceName}</td>
              <td className="px-4 py-3">
                <StatusBadge tone={getIncidentSeverityTone(incident.severity)} dot>
                  {incident.severity}
                </StatusBadge>
              </td>
              <td className="px-4 py-3">
                <StatusBadge tone={getIncidentStatusTone(incident.status)}>{incident.status}</StatusBadge>
              </td>
              <td className="px-4 py-3 text-ops-muted">{incident.assignee ?? "Unassigned"}</td>
              <td className="px-4 py-3">
                <StatusBadge tone={getDueTone(incident.dueDate, incident.status)}>
                  {formatDueDate(incident.dueDate)}
                </StatusBadge>
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/admin/incidents/${incident.id}`}
                  className="inline-flex h-8 items-center justify-center rounded-md border border-ops-border bg-ops-surface px-3 text-xs font-semibold text-[#b7f5e4] transition-colors hover:border-ops-accent/50"
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </DataTableBody>
      </DataTable>
    </DataTableFrame>
  );
}
