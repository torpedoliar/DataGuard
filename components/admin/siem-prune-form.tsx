"use client";

import { pruneEventsBefore, type PruneEventsResult } from "@/actions/siem-events";
import ActionButton from "@/components/ui/action-button";
import { useModalDismiss } from "@/components/ui/use-modal-dismiss";
import { useActionState, useEffect, useRef, useState } from "react";
import { AlertTriangle, Scissors, ShieldCheck, X } from "lucide-react";

const initialState: PruneEventsResult = { ok: false };
const CONFIRM_WORD = "PRUNE";

function thirtyDaysAgoIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

export default function SiemPruneForm() {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [cutoff, setCutoff] = useState<string>(thirtyDaysAgoIso());
  const [includeEvents, setIncludeEvents] = useState<boolean>(true);
  const [includeRawOrphans, setIncludeRawOrphans] = useState<boolean>(false);
  const [confirmText, setConfirmText] = useState<string>("");
  const [showModal, setShowModal] = useState<boolean>(false);

  const [state, formAction, isPending] = useActionState(
    async (_prev: PruneEventsResult, formData: FormData) => {
      const cutoffDate = String(formData.get("cutoffDate") ?? "");
      const rawEventsOnly = String(formData.get("rawEventsOnly") ?? "false") === "true";
      return pruneEventsBefore(cutoffDate, { rawEventsOnly });
    },
    initialState,
  );
  const closeModal = () => {
    if (isPending) return;
    setShowModal(false);
    setConfirmText("");
  };
  useModalDismiss(closeModal, showModal, !isPending);

  // Open the modal; do not submit yet.
  const handleOpenConfirm = (event: React.FormEvent<HTMLFormElement>) => {
    if (pendingClose.current) return;
    event.preventDefault();
    if (!cutoff || (!includeEvents && !includeRawOrphans)) return;
    setShowModal(true);
  };

  // Confirmed submission: programmatically requestSubmit on the real form and
  // set a ref so the next render can close the modal once the result lands.
  const pendingClose = useRef<boolean>(false);
  const handleConfirmed = () => {
    if (confirmText.trim() !== CONFIRM_WORD) return;
    if (!formRef.current) return;
    pendingClose.current = true;
    formRef.current.requestSubmit();
  };

  // Close the confirmation modal after a successful prune result.
  useEffect(() => {
    if (pendingClose.current && state.ok && state.deletedEvents !== undefined) {
      pendingClose.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowModal(false);
      setConfirmText("");
    }
  }, [state]);

  return (
    <section className="ops-panel p-5">
      <div className="mb-3 flex items-center gap-2">
        <Scissors className="size-4 text-ops-danger" aria-hidden="true" />
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-danger">
          Manual prune (N21)
        </h2>
      </div>
      <p className="mb-4 text-[13px] text-ops-muted">
        Permanently deletes parsed syslog events (and optionally orphan raw events) older than the
        chosen date. This action cannot be undone. Superadmin only.
      </p>

      <form ref={formRef} action={formAction} onSubmit={handleOpenConfirm} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="prune-cutoff" className="mb-1.5 block text-[13px] font-medium text-ops-muted">
              Prune events received before
            </label>
            <input
              id="prune-cutoff"
              name="cutoffDate"
              type="date"
              required
              value={cutoff}
              onChange={(event) => setCutoff(event.target.value)}
              aria-label="Cutoff date for events to prune"
              className="ops-input w-full px-3 py-2 text-sm tabular-nums"
            />
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <label className="flex items-center gap-2 text-sm text-ops-text">
              <input
                type="checkbox"
                name="includeEvents"
                checked={includeEvents}
                onChange={(event) => setIncludeEvents(event.target.checked)}
                aria-label="Prune parsed syslog_events rows"
                className="size-4 rounded border-ops-border-strong accent-ops-danger"
              />
              <span>
                Prune <code className="font-mono text-xs text-ops-danger">syslog_events</code>
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-ops-text">
              <input
                type="checkbox"
                name="rawEventsOnly"
                checked={includeRawOrphans}
                onChange={(event) => setIncludeRawOrphans(event.target.checked)}
                aria-label="Prune orphan syslog_events_raw rows"
                className="size-4 rounded border-ops-border-strong accent-ops-danger"
              />
              <span>
                Prune <code className="font-mono text-xs text-ops-danger">syslog_events_raw</code> (orphans only)
              </span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ops-subtle">
            Deletes are batched (10k rows) and scoped to the active site.
          </p>
          <ActionButton
            type="submit"
            variant="danger"
            isPending={isPending}
            disabled={!cutoff || (!includeEvents && !includeRawOrphans)}
            icon={<Scissors className="size-4" />}
          >
            Prune
          </ActionButton>
        </div>

        {state.message && !state.ok && (
          <div className="flex items-start gap-2 rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{state.message}</span>
          </div>
        )}
        {state.ok && state.deletedEvents !== undefined && (
          <div className="flex items-start gap-2 rounded-md border border-ops-success/25 bg-ops-success-soft px-3 py-2.5 text-[13px] text-ops-success">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Prune complete.</p>
              <p className="text-xs text-ops-success/80">
                Deleted <strong className="tabular-nums">{state.deletedEvents.toLocaleString()}</strong> parsed events
                {state.deletedRaw !== undefined && state.deletedRaw > 0 ? (
                  <>
                    {" "}and <strong className="tabular-nums">{state.deletedRaw.toLocaleString()}</strong> orphan raw events
                  </>
                ) : null}
                {" "}before <code className="font-mono">{state.cutoffDate}</code>.
              </p>
            </div>
          </div>
        )}
      </form>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="ops-panel w-full max-w-md p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-lg bg-ops-danger-soft text-ops-danger">
                <AlertTriangle className="size-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Confirm manual prune</h3>
                <p className="text-xs text-ops-muted">This action is irreversible.</p>
              </div>
            </div>
            <p className="mb-4 text-sm text-ops-muted">
              Will delete parsed syslog events
              {includeRawOrphans ? " and orphan raw events " : " "}
              received before <code className="rounded-sm bg-ops-surface-raised px-1 py-0.5 font-mono text-ops-danger">{cutoff}</code>.
              {includeRawOrphans ? "" : " Raw events with surviving parsed events are kept."}
            </p>
            <p className="mb-2 text-[13px] text-ops-muted">
              Type <code className="font-mono text-ops-danger">{CONFIRM_WORD}</code> to confirm:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              autoFocus
              placeholder={CONFIRM_WORD}
              className="ops-input mb-4 w-full px-3 py-2 font-mono text-sm"
            />
            <div className="flex items-center justify-end gap-2">
              <ActionButton
                type="button"
                variant="secondary"
                onClick={closeModal}
                icon={<X className="size-4" />}
              >
                Cancel
              </ActionButton>
              <ActionButton
                type="button"
                variant="danger"
                onClick={handleConfirmed}
                disabled={confirmText.trim() !== CONFIRM_WORD}
                isPending={isPending}
                icon={<Scissors className="size-4" />}
              >
                Prune now
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
