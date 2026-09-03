"use client";

import { changeIncidentStatus } from "@/actions/incidents";
import ActionButton from "@/components/ui/action-button";
import FormSection from "@/components/ui/form-section";
import { allowedNextStatuses, resolutionActions, resolutionCategories, type IncidentStatus } from "@/lib/incidents";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

type ActionState = { message?: string; success?: boolean } | null;

const fieldClass = "ops-input w-full px-3 py-2 text-sm";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted";

export default function IncidentStatusForm({
  incidentId,
  currentStatus,
  isAdmin,
  isAssignee,
}: {
  incidentId: number;
  currentStatus: IncidentStatus;
  isAdmin: boolean;
  isAssignee: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(changeIncidentStatus, null);

  useEffect(() => {
    if (state?.success) {
      router.refresh();
    }
  }, [state?.success, router]);

  const allowed = allowedNextStatuses({ isAdmin, isAssignee, current: currentStatus });
  const [selectedStatus, setSelectedStatus] = useState<IncidentStatus>(
    allowed.includes(currentStatus) ? currentStatus : (allowed[0] ?? currentStatus),
  );

  const isResolutionState = selectedStatus === "Resolved" || selectedStatus === "Verified";

  return (
    <form key={`${incidentId}-${currentStatus}`} action={formAction}>
      <input type="hidden" name="incidentId" value={incidentId} />
      <FormSection
        title="Status"
        description="Move the incident through the remediation workflow."
        footer={
          <div className="space-y-3">
            {state?.message && <p className={state.success ? "text-sm text-emerald-300" : "text-sm text-red-300"}>{state.message}</p>}
            {state?.success && <p className="text-sm text-emerald-300">Status updated.</p>}
            {allowed.length === 0 ? (
              <p className="text-xs text-ops-muted">No further status transitions available for this incident.</p>
            ) : (
              <ActionButton type="submit" isPending={pending} className="w-full">
                Update Status
              </ActionButton>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Status</label>
            <select
              name="status"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as IncidentStatus)}
              className={fieldClass}
              disabled={allowed.length === 0}
            >
              {allowed.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>
              Resolution Category {isResolutionState && <span className="text-red-400">*</span>}
            </label>
            <select
              name="resolutionCategory"
              className={fieldClass}
              required={isResolutionState}
            >
              <option value="">Resolution category</option>
              {resolutionCategories.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>
              Resolution Action {isResolutionState && <span className="text-red-400">*</span>}
            </label>
            <select
              name="resolutionAction"
              className={fieldClass}
              required={isResolutionState}
            >
              <option value="">Resolution action</option>
              {resolutionActions.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Note</label>
            <textarea name="note" rows={3} className={fieldClass} placeholder="Status note" />
          </div>
        </div>
      </FormSection>
    </form>
  );
}
