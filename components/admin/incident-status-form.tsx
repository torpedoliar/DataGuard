"use client";

import { changeIncidentStatus } from "@/actions/incidents";
import { incidentStatuses, resolutionActions, resolutionCategories } from "@/lib/incidents";
import { useActionState } from "react";

type ActionState = { message?: string; success?: boolean } | null;

export default function IncidentStatusForm({ incidentId, currentStatus }: { incidentId: number; currentStatus: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(changeIncidentStatus, null);

  return (
    <form action={formAction} className="glow-card p-5 space-y-4">
      <input type="hidden" name="incidentId" value={incidentId} />
      <h2 className="text-lg font-bold text-white">Status</h2>
      <select name="status" defaultValue={currentStatus} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white">
        {incidentStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
      </select>
      <select name="resolutionCategory" className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white">
        <option value="">Resolution category</option>
        {resolutionCategories.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      <select name="resolutionAction" className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white">
        <option value="">Resolution action</option>
        {resolutionActions.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      <textarea name="note" rows={3} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white" placeholder="Status note" />
      {state?.message && <p className="text-sm text-red-300">{state.message}</p>}
      {state?.success && <p className="text-sm text-green-300">Status updated.</p>}
      <button disabled={pending} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
        Update Status
      </button>
    </form>
  );
}
