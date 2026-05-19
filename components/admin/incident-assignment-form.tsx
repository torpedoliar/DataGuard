"use client";

import { assignIncident } from "@/actions/incidents";
import { incidentSeverities } from "@/lib/incidents";
import { useActionState } from "react";

type UserOption = { id: number; username: string };
type ActionState = { message?: string; success?: boolean } | null;

function formatDateTimeLocal(date: Date | null) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 16);
}

export default function IncidentAssignmentForm({
  incidentId,
  users,
  currentAssigneeId,
  currentSeverity,
  currentDueDate,
}: {
  incidentId: number;
  users: UserOption[];
  currentAssigneeId: number | null;
  currentSeverity: string;
  currentDueDate: Date | null;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(assignIncident, null);

  return (
    <form action={formAction} className="glow-card p-5 space-y-4">
      <input type="hidden" name="incidentId" value={incidentId} />
      <h2 className="text-lg font-bold text-white">Assignment</h2>
      <select name="assignedToId" defaultValue={currentAssigneeId ?? ""} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white">
        <option value="">Unassigned</option>
        {users.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}
      </select>
      <select name="severity" defaultValue={currentSeverity} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white">
        {incidentSeverities.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
      </select>
      <input name="dueDate" type="datetime-local" defaultValue={formatDateTimeLocal(currentDueDate)} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white" />
      {state?.message && <p className="text-sm text-red-300">{state.message}</p>}
      {state?.success && <p className="text-sm text-green-300">Assignment saved.</p>}
      <button disabled={pending} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
        Save Assignment
      </button>
    </form>
  );
}
