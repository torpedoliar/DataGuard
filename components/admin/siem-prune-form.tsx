"use client";

import { pruneEventsBefore, type PruneEventsResult } from "@/actions/siem-events";
import { useActionState, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Scissors, ShieldCheck, X } from "lucide-react";

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
      return pruneEventsBefore(cutoffDate, { rawEventsOnly, siteScoped: true });
    },
    initialState,
  );

  // Open the modal; do not submit yet.
  const handleOpenConfirm = (event: React.FormEvent<HTMLFormElement>) => {
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
    <section className="rounded-lg border border-red-500/30 bg-red-500/5 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Scissors className="size-4 text-red-300" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-red-200">
          Manual Prune (N21)
        </h2>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Permanently deletes parsed syslog events (and optionally orphan raw events) older than the
        chosen date. This action cannot be undone. Superadmin only.
      </p>

      <form ref={formRef} action={formAction} onSubmit={handleOpenConfirm} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="prune-cutoff" className="mb-1 block text-xs font-medium text-slate-300">
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
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            />
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                name="includeEvents"
                checked={includeEvents}
                onChange={(event) => setIncludeEvents(event.target.checked)}
                aria-label="Prune parsed syslog_events rows"
                className="size-4 rounded border-slate-600 bg-slate-900 text-red-500 focus:ring-red-500"
              />
              <span>
                Prune <code className="font-mono text-xs text-red-300">syslog_events</code>
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                name="rawEventsOnly"
                checked={includeRawOrphans}
                onChange={(event) => setIncludeRawOrphans(event.target.checked)}
                aria-label="Prune orphan syslog_events_raw rows"
                className="size-4 rounded border-slate-600 bg-slate-900 text-red-500 focus:ring-red-500"
              />
              <span>
                Prune <code className="font-mono text-xs text-red-300">syslog_events_raw</code> (orphans only)
              </span>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Deletes are batched (10k rows) and scoped to the active site.
          </p>
          <button
            type="submit"
            disabled={isPending || !cutoff || (!includeEvents && !includeRawOrphans)}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Pruning...
              </>
            ) : (
              <>
                <Scissors className="size-4" /> Prune
              </>
            )}
          </button>
        </div>

        {state.message && !state.ok && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{state.message}</span>
          </div>
        )}
        {state.ok && state.deletedEvents !== undefined && (
          <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">Prune complete.</p>
              <p className="text-xs text-emerald-300/80">
                Deleted <strong>{state.deletedEvents.toLocaleString()}</strong> parsed events
                {state.deletedRaw !== undefined && state.deletedRaw > 0 ? (
                  <>
                    {" "}and <strong>{state.deletedRaw.toLocaleString()}</strong> orphan raw events
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
          <div className="w-full max-w-md rounded-xl border border-red-500/30 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-full bg-red-500/20 text-red-300">
                <AlertTriangle className="size-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Confirm manual prune</h3>
                <p className="text-xs text-slate-400">This action is irreversible.</p>
              </div>
            </div>
            <p className="mb-4 text-sm text-slate-300">
              Will delete parsed syslog events
              {includeRawOrphans ? " and orphan raw events " : " "}
              received before <code className="rounded bg-slate-800 px-1 py-0.5 font-mono text-red-300">{cutoff}</code>.
              {includeRawOrphans ? "" : " Raw events with surviving parsed events are kept."}
            </p>
            <p className="mb-2 text-xs text-slate-400">
              Type <code className="font-mono text-red-300">{CONFIRM_WORD}</code> to confirm:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              autoFocus
              placeholder={CONFIRM_WORD}
              className="mb-4 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm uppercase tracking-widest text-white focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setConfirmText("");
                }}
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
              >
                <X className="size-3" /> Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmed}
                disabled={confirmText.trim() !== CONFIRM_WORD || isPending}
                className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : <Scissors className="size-4" />}
                Prune now
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
