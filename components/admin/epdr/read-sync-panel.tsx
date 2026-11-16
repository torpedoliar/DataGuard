"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock3, CloudDownload, LoaderCircle, RefreshCw, RotateCw, TriangleAlert } from "lucide-react";
import { getEpdrReadSyncStatus, requestEpdrReadSync } from "@/actions/epdr-read-sync";
import type { ReadSyncStatus } from "@/lib/epdr/read-sync-queue";
import { scheduleSyncRefresh } from "@/lib/epdr/sync-refresh";

export default function ReadSyncPanel({ enabled }: { enabled: boolean }) {
  const t = useTranslations("Epdr.syncV2");
  const router = useRouter();
  const [status, setStatus] = useState<ReadSyncStatus | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [watch, setWatch] = useState(0);
  const observed = useRef<{ id: number | null; state: string } | null>(null);

  useEffect(() => {
    let active = true;
    async function update() {
      try {
        const result = await getEpdrReadSyncStatus();
        if (active) {
          const previous = observed.current;
          const terminal = ["succeeded", "partial", "failed", "cancelled"].includes(result.status);
          observed.current = { id: result.requestId, state: result.status };
          setStatus(result);
          if (terminal && previous && (previous.id !== result.requestId || previous.state !== result.status)) router.refresh();
        }
      } catch {
        if (active) setFeedback(t("unavailable"));
      }
    }
    void update();
    const cleanup = scheduleSyncRefresh(() => { void update(); });
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

  const safeStatus = status?.status ?? "idle";
  const active = pending || safeStatus === "queued" || safeStatus === "running";
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
          {feedback && <p role="status" className="text-xs font-medium text-ops-text">{feedback}</p>}
          {status?.finishedAt && <p className="text-xs text-ops-subtle">{t("finished", { time: new Date(status.finishedAt).toLocaleString() })}</p>}
        </div>
      </div>
    </div>
    <div className="flex shrink-0 flex-wrap gap-2 pl-12 lg:pl-0">
      <button type="button" disabled={!enabled || pending || safeStatus === "queued" || safeStatus === "running"} onClick={request}
        className="inline-flex h-9 items-center gap-2 rounded-md bg-ops-accent px-3 text-sm font-medium text-ops-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"><RotateCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} aria-hidden />{t("request")}</button>
      <button type="button" onClick={() => { setWatch((value) => value + 1); router.refresh(); }}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-ops-border px-3 text-sm text-ops-text transition-colors hover:bg-ops-surface-raised"><RefreshCw className="size-3.5" aria-hidden />{t("refresh")}</button>
    </div>
  </section>;
}
