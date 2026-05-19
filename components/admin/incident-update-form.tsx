"use client";

import { addIncidentUpdate } from "@/actions/incidents";
import { useActionState } from "react";

type ActionState = { message?: string; success?: boolean } | null;

export default function IncidentUpdateForm({ incidentId }: { incidentId: number }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(addIncidentUpdate, null);

  return (
    <form action={formAction} encType="multipart/form-data" className="glow-card p-5 space-y-4">
      <input type="hidden" name="incidentId" value={incidentId} />
      <h2 className="text-lg font-bold text-white">Add Update</h2>
      <textarea name="note" rows={4} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white" placeholder="Progress note" />
      <input name="photo" type="file" accept="image/*" className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-white" />
      {state?.message && <p className="text-sm text-red-300">{state.message}</p>}
      {state?.success && <p className="text-sm text-green-300">Update added.</p>}
      <button disabled={pending} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
        Add Update
      </button>
    </form>
  );
}
