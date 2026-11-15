"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
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
  return <section className="flex flex-col gap-3 rounded-lg border border-ops-border bg-ops-surface p-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="space-y-1 text-sm">
      <p className="font-medium text-ops-text">{t("title")}</p>
      <p className="text-ops-muted">{t("hint")}</p>
      <p role="status" className="text-ops-muted">{t(`states.${safeStatus}`)}</p>
      {safeStatus === "queued" && <p className="text-ops-muted">{t("waiting")}</p>}
      {feedback && <p role="status" className="text-ops-text">{feedback}</p>}
      {status?.finishedAt && <p className="text-xs text-ops-muted">{t("finished", { time: new Date(status.finishedAt).toLocaleString() })}</p>}
    </div>
    <div className="flex shrink-0 gap-2">
      <button type="button" disabled={!enabled || pending || safeStatus === "queued" || safeStatus === "running"} onClick={request}
        className="rounded-md bg-ops-accent px-3 py-2 text-sm font-medium text-ops-bg disabled:opacity-50">{t("request")}</button>
      <button type="button" onClick={() => { setWatch((value) => value + 1); router.refresh(); }}
        className="rounded-md border border-ops-border px-3 py-2 text-sm text-ops-text">{t("refresh")}</button>
    </div>
  </section>;
}
