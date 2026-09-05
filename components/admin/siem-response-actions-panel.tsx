"use client";

import { approveSiemResponseAction, cancelSiemResponseAction, listSiemResponseActions, requestSiemResponseAction, type SiemResponseActionRow } from "@/actions/siem-response-actions";
import ActionButton from "@/components/ui/action-button";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

const STATUS_TONE: Record<string, string> = {
  pending_approval: "text-amber-300 border-amber-400/40 bg-amber-400/10",
  approved: "text-blue-300 border-blue-400/40 bg-blue-400/10",
  executed: "text-emerald-300 border-emerald-400/40 bg-emerald-400/10",
  failed: "text-red-300 border-red-400/40 bg-red-400/10",
  cancelled: "text-slate-400 border-slate-500/40 bg-slate-500/10",
};

export default function SiemResponseActionsPanel({ findingId }: { findingId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Lazy-loaded on expand (same pattern as the Notes panel); nulled after a
  // successful mutation so the next open refetches fresh status.
  const [actions, setActions] = useState<SiemResponseActionRow[] | null>(null);
  const [requestState, requestAction, requestPending] = useActionState(requestSiemResponseAction, undefined);
  const [approveState, approveAction, approvePending] = useActionState(approveSiemResponseAction, undefined);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelSiemResponseAction, undefined);

  useEffect(() => {
    if (requestState?.success || approveState?.success || cancelState?.success) {
      setActions(null);
      router.refresh();
    }
  }, [requestState?.success, approveState?.success, cancelState?.success, router]);

  async function toggle() {
    setOpen((prev) => !prev);
    if (actions === null) setActions(await listSiemResponseActions(findingId));
  }

  const message = [requestState?.message, approveState?.message, cancelState?.message].find((value) => value && !(requestState?.success || approveState?.success || cancelState?.success));

  return (
    <div className="space-y-2 text-left">
      <ActionButton type="button" size="sm" variant="ghost" onClick={() => void toggle()}>
        Respons{actions ? ` (${actions.length})` : ""}
      </ActionButton>

      {open && (
        <div className="w-full max-w-xl space-y-3 rounded-md border border-ops-border bg-ops-surface p-3">
          {actions === null ? (
            <p className="text-xs text-ops-muted">Loading respons…</p>
          ) : actions.length === 0 ? (
            <p className="text-xs text-ops-muted">Belum ada aksi respons diajukan.</p>
          ) : (
            <ul className="space-y-1.5">
              {actions.map((action) => (
                <li key={action.id} className="flex items-center justify-between gap-2 rounded border border-ops-border/60 p-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-ops-text">{action.actionType}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] ${STATUS_TONE[action.status] ?? ""}`}>{action.status}</span>
                    </div>
                    <div className="truncate text-[10px] text-ops-muted">
                      {action.webhookUrl} · oleh {action.requestedByName ?? "?"}{action.approvedByName ? ` · disetujui ${action.approvedByName}` : ""}
                      {action.responseStatus ? ` · HTTP ${action.responseStatus}` : ""}{action.error ? ` · ${action.error}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {action.status === "pending_approval" && (
                      <form action={approveAction}>
                        <input type="hidden" name="id" value={action.id} />
                        <ActionButton type="submit" size="sm" variant="secondary" isPending={approvePending}>Approve</ActionButton>
                      </form>
                    )}
                    {action.status !== "executed" && action.status !== "cancelled" && (
                      <form action={cancelAction}>
                        <input type="hidden" name="id" value={action.id} />
                        <ActionButton type="submit" size="sm" variant="ghost" isPending={cancelPending}>Cancel</ActionButton>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form action={requestAction} className="space-y-2 border-t border-ops-border/60 pt-2">
            <input type="hidden" name="findingId" value={findingId} />
            <div className="grid gap-2 sm:grid-cols-3">
              <select name="actionType" className="ops-input h-9 px-2 text-xs">
                <option value="block_ip">block_ip</option>
                <option value="disable_port">disable_port</option>
                <option value="isolate_host">isolate_host</option>
                <option value="custom">custom</option>
              </select>
              <input name="webhookUrl" required placeholder="https://fw-api.example/block" className="ops-input h-9 px-2 font-mono text-xs sm:col-span-2" />
            </div>
            <textarea name="payload" rows={2} placeholder='{"ip":"203.0.113.9"} (JSON opsional)' className="w-full rounded border border-ops-border bg-ops-surface px-2 py-1.5 font-mono text-xs text-ops-text" />
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-ops-muted">Eksekusi butuh approval admin lain (two-person rule).</p>
              <ActionButton type="submit" size="sm" isPending={requestPending}>Ajukan</ActionButton>
            </div>
          </form>
          {message && <p className="text-xs text-red-200">{message}</p>}
          {requestState?.errors && <p className="text-xs text-red-200">{Object.values(requestState.errors).flat().join(" ")}</p>}
        </div>
      )}
    </div>
  );
}
