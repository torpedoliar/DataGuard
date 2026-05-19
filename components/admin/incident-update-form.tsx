"use client";

import { addIncidentUpdate } from "@/actions/incidents";
import ActionButton from "@/components/ui/action-button";
import FormSection from "@/components/ui/form-section";
import { useActionState } from "react";

type ActionState = { message?: string; success?: boolean } | null;

const fieldClass = "ops-input w-full px-3 py-2 text-sm";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted";

export default function IncidentUpdateForm({ incidentId }: { incidentId: number }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(addIncidentUpdate, null);

  return (
    <form action={formAction} encType="multipart/form-data">
      <input type="hidden" name="incidentId" value={incidentId} />
      <FormSection
        title="Add Update"
        description="Attach progress notes and evidence."
        footer={
          <div className="space-y-3">
            {state?.message && <p className={state.success ? "text-sm text-emerald-300" : "text-sm text-red-300"}>{state.message}</p>}
            {state?.success && <p className="text-sm text-emerald-300">Update added.</p>}
            <ActionButton type="submit" isPending={pending} className="w-full">
              Add Update
            </ActionButton>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Progress Note</label>
            <textarea name="note" rows={4} className={fieldClass} placeholder="Progress note" />
          </div>
          <div>
            <label className={labelClass}>Evidence Photo</label>
            <input
              name="photo"
              type="file"
              accept="image/*"
              className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-ops-surface file:px-3 file:py-2 file:text-ops-text"
            />
          </div>
        </div>
      </FormSection>
    </form>
  );
}
