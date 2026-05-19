import Link from "next/link";

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

function formatDueDate(date: Date | null) {
  if (!date) return "-";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function IncidentTable({ incidents }: { incidents: IncidentRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700/50">
      <table className="w-full text-left text-sm whitespace-nowrap">
        <thead className="bg-[#0d1526] text-slate-500 text-xs uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Incident</th>
            <th className="px-4 py-3">Device</th>
            <th className="px-4 py-3">Severity</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Assignee</th>
            <th className="px-4 py-3">Due</th>
            <th className="px-4 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/50">
          {incidents.length === 0 ? (
            <tr>
              <td colSpan={7} className="p-6 text-center text-slate-500">No incidents found.</td>
            </tr>
          ) : incidents.map((incident) => (
            <tr key={incident.id} className="hover:bg-slate-800/30 transition-colors">
              <td className="px-4 py-3">
                <div className="font-medium text-white">#{incident.id} {incident.title}</div>
                {incident.isRecurring && <div className="text-xs text-red-300 mt-1">Recurring issue</div>}
              </td>
              <td className="px-4 py-3 text-slate-300">{incident.deviceName}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${severityClass[incident.severity] ?? severityClass.Low}`}>
                  {incident.severity}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass[incident.status] ?? statusClass.Open}`}>
                  {incident.status}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-400">{incident.assignee ?? "Unassigned"}</td>
              <td className="px-4 py-3 text-slate-400">{formatDueDate(incident.dueDate)}</td>
              <td className="px-4 py-3 text-right">
                <Link href={`/admin/incidents/${incident.id}`} className="inline-flex items-center justify-center rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-blue-300 hover:bg-slate-700">
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
