"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock3, CloudDownload, LoaderCircle, RefreshCw, RotateCw, TriangleAlert, XCircle } from "lucide-react";
import { cancelEpdrReadSync, getEpdrReadSyncStatus, requestEpdrReadSync } from "@/actions/epdr-read-sync";
import type { ReadSyncStatus } from "@/lib/epdr/read-sync-queue";
import { scheduleSyncRefresh } from "@/lib/epdr/sync-refresh";

const TERMINAL_STATUSES = ["succeeded", "partial", "failed", "cancelled"];
// Worker/cancellation codes the panel can explain; unknown codes stay verbatim
// so a future backend code is never hidden behind a generic message.
const EXPLAINED_ERRORS = new Set([
  "worker_timeout",
  "endpoint_sync_failed",
  "endpoint_sync_partial",
  "connection_changed",
  "cancelled",
  "read_sync_actor_unavailable",
  "read_sync_membership_revoked",
]);
const WORKER_STALE_MS = 5 * 60_000;

export default function ReadSyncPanel({ enabled }: { enabled: boolean }) {
  const t = useTranslations("Epdr.syncV2");
  const router = useRouter();
  const [status, setStatus] = useState<ReadSyncStatus | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [watch, setWatch] = useState(0);
  const [pollingDone, setPollingDone] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const observed = useRef<{ id: number | null; state: string } | null>(null);

  useEffect(() => {
    let active = true;
    setPollingDone(false);
    async function update() {
      try {
        const result = await getEpdrReadSyncStatus();
        if (active) {
          const previous = observed.current;
          const terminal = TERMINAL_STATUSES.includes(result.status);
          observed.current = { id: result.requestId, state: result.status };
          setStatus(result);
          if (terminal && previous && (previous.id !== result.requestId || previous.state !== result.status)) router.refresh();
        }
      } catch {
        if (active) setFeedback(t("unavailable"));
      }
    }
    void update();
    const cleanup = scheduleSyncRefresh(
      () => { void update(); },
      () => { if (active) setPollingDone(true); },
    );
    return () => { active = false; cleanup(); };
  }, [watch, t, router]);

  function request() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await requestEpdrReadSync();
        if (result.status === "queued" || result.status === "already_pending") {
          setFeedback(t(result.status));
        } else if (result.status === "cooldown") {
          setFeedback(t("cooldown", { time: new Date(result.retryAt).toLocaleTimeString() }));
        } else setFeedback(t("unavailable"));
        setWatch((value) => value + 1);
      } catch { setFeedback(t("unavailable")); }
    });
  }

  function cancel() {
    setFeedback(null);
    setCancelling(true);
    void (async () => {
      try {
        const result = await cancelEpdrReadSync();
        setFeedback(result.status === "cancelled" ? t("cancelDone") : t("unavailable"));
      } catch { setFeedback(t("unavailable")); }
      finally {
        setCancelling(false);
        setWatch((value) => value + 1);
      }
    })();
  }

  const safeStatus = status?.status ?? "idle";
  const activeRequest = safeStatus === "queued" || safeStatus === "running";
  const terminal = TERMINAL_STATUSES.includes(safeStatus);
  const active = pending || activeRequest;
  const workerSeenAt = status?.workerLastSeenAt ? new Date(status.workerLastSeenAt) : null;
  const workerStale = !workerSeenAt || Date.now() - workerSeenAt.getTime() > WORKER_STALE_MS;
  const startedAt = status?.startedAt ? new Date(status.startedAt) : null;
  // While running, the renewed lease is the authoritative liveness signal: a
  // long provider read can outlive the heartbeat window without being dead.
  const leaseUntil = status?.leaseExpiresAt ? new Date(status.leaseExpiresAt) : null;
  const leaseActive = leaseUntil ? leaseUntil.getTime() > Date.now() : false;
  const StateIcon = safeStatus === "succeeded" ? CheckCircle2 : active ? LoaderCircle : safeStatus === "idle" ? Clock3 : safeStatus === "partial" || safeStatus === "failed" || safeStatus === "cancelled" ? TriangleAlert : CloudDownload;
  return <section className="ops-panel flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
    <div className="flex min-w-0 items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-ops-border bg-ops-surface-raised text-ops-accent"><StateIcon className={`size-4 ${active ? "animate-spin" : ""}`} aria-hidden /></span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold text-ops-text">{t("title")}</h2>
          <p className="text-xs text-ops-muted">{t(`states.${safeStatus}`)}</p>
        </div>
        <p role="status" className="sr-only">{t(`states.${safeStatus}`)}</p>
        <p className="mt-1 max-w-4xl text-xs leading-5 text-ops-muted">{t("hint")}</p>
        <div className="mt-2 space-y-1">
          {safeStatus === "queued" && <p className="text-xs text-ops-warning">{t("waiting")}</p>}
          {safeStatus === "queued" && (
            <p className={workerStale ? "text-xs text-ops-warning" : "text-xs text-ops-subtle"}>
              {workerSeenAt ? t("workerLastSeen", { time: workerSeenAt.toLocaleString() }) : t("workerMissing")}
            </p>
          )}
          {safeStatus === "running" && startedAt && <p className="text-xs text-ops-subtle">{t("started", { time: startedAt.toLocaleString() })}</p>}
          {safeStatus === "running" && leaseUntil && (
            <p className={leaseActive ? "text-xs text-ops-subtle" : "text-xs text-ops-warning"}>
              {leaseActive ? t("leaseActive", { time: leaseUntil.toLocaleString() }) : t("leaseExpired")}
            </p>
          )}
          {pollingDone && activeRequest && <p className="text-xs text-ops-warning">{t("pollingStopped")}</p>}
          {status?.error && terminal && (
            <p className={safeStatus === "succeeded" ? "text-xs text-ops-muted" : "text-xs text-ops-danger"}>
              {EXPLAINED_ERRORS.has(status.error) ? t(`errors.${status.error}`) : status.error}
            </p>
          )}
          {feedback && <p role="status" className="text-xs font-medium text-ops-text">{feedback}</p>}
          {status?.finishedAt && <p className="text-xs text-ops-subtle">{t("finished", { time: new Date(status.finishedAt).toLocaleString() })}</p>}
        </div>
      </div>
    </div>
    <div className="flex shrink-0 flex-wrap gap-2 pl-12 lg:pl-0">
      <button type="button" disabled={!enabled || pending || activeRequest} onClick={request}
        className="inline-flex h-9 items-center gap-2 rounded-md bg-ops-accent px-3 text-sm font-medium text-ops-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"><RotateCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} aria-hidden />{t("request")}</button>
      {activeRequest && (
        <button type="button" disabled={cancelling} onClick={cancel}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-ops-border px-3 text-sm text-ops-text transition-colors hover:bg-ops-surface-raised disabled:cursor-not-allowed disabled:opacity-50"><XCircle className="size-3.5" aria-hidden />{t("cancel")}</button>
      )}
      <button type="button" onClick={() => { setWatch((value) => value + 1); router.refresh(); }}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-ops-border px-3 text-sm text-ops-text transition-colors hover:bg-ops-surface-raised"><RefreshCw className="size-3.5" aria-hidden />{t("refresh")}</button>
    </div>
  </section>;
}
