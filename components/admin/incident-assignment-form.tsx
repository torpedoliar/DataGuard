"use client";

import { assignIncident } from "@/actions/incidents";
import ActionButton from "@/components/ui/action-button";
import FormSection from "@/components/ui/form-section";
import { incidentSeverities } from "@/lib/incidents";
import { useActionState } from "react";

type UserOption = { id: number; username: string };
type ActionState = { message?: string; success?: boolean } | null;

function formatDateTimeLocal(date: Date | null) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 16);
}

const fieldClass = "ops-input w-full px-3 py-2 text-sm";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted";

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
    <form action={formAction}>
      <input type="hidden" name="incidentId" value={incidentId} />
      <FormSection
        title="Assignment"
        description="Set owner, severity, and target date."
        footer={
          <div className="space-y-3">
            {state?.message && <p className={state.success ? "text-sm text-emerald-300" : "text-sm text-red-300"}>{state.message}</p>}
            {state?.success && <p className="text-sm text-emerald-300">Assignment saved.</p>}
            <ActionButton type="submit" isPending={pending} className="w-full">
              Save Assignment
            </ActionButton>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Assignee</label>
            <select name="assignedToId" defaultValue={currentAssigneeId ?? ""} className={fieldClass}>
              <option value="">Unassigned</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Severity</label>
            <select name="severity" defaultValue={currentSeverity} className={fieldClass}>
              {incidentSeverities.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Due Date</label>
            <input name="dueDate" type="datetime-local" defaultValue={formatDateTimeLocal(currentDueDate)} className={fieldClass} />
          </div>
        </div>
      </FormSection>
    </form>
  );
}
