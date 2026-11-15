"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  getEpdrLocalPlaybookRun, getEpdrLocalPlaybookRuns, resumeEpdrLocalPlaybook,
  startEpdrLocalPlaybook, type LocalPlaybookRunDetail, type LocalPlaybookRunSummary,
} from "@/actions/epdr-local-playbooks";
import { requestEpdrLocalApproval } from "@/actions/epdr-local-approvals";

type RunList = Exclude<Awaited<ReturnType<typeof getEpdrLocalPlaybookRuns>>, { message: string }>;
type ApprovalIntent = "scan" | "isolate";

/** Only a proposed local routing record with matching template steps may request approval. */
function proposedIntents(evidence: unknown): ApprovalIntent[] {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
  const record = evidence as Record<string, unknown>;
  const policy = record.responsePolicy as { status?: unknown } | undefined;
  const definition = record.definition as { template?: { steps?: unknown } } | undefined;
  const steps = definition?.template?.steps;
  if (policy?.status !== "proposed" || !Array.isArray(steps)) return [];
  return (["scan", "isolate"] as const).filter((intent) => steps.includes(intent));
}

export default function LocalPlaybookRunner() {
  const t = useTranslations("Epdr.localRunV2");
  const [runs, setRuns] = useState<RunList | null>(null);
  const [detail, setDetail] = useState<LocalPlaybookRunDetail | null>(null);
  const [versionId, setVersionId] = useState("");
  const [detectionId, setDetectionId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;
    getEpdrLocalPlaybookRuns({ page }).then((data) => {
      if (!active) return;
      if ("message" in data) setError(true);
      else {
        setRuns(data); setError(false);
        const currentPage = data.page ?? 1;
        if (currentPage !== page) setPage(currentPage);
      }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [revision, page]);

  function perform(operation: () => Promise<void>) {
    startTransition(async () => {
      setError(false);
      try { await operation(); } catch { setError(true); }
    });
  }

  async function loadRun(runId: number) {
    setDetail(null);
    const data = await getEpdrLocalPlaybookRun(runId);
    if ("message" in data) setError(true);
    else setDetail(data);
  }

  function openRun(runId: number) {
    perform(() => loadRun(runId));
  }

  const intents = detail ? proposedIntents(detail.evidence) : [];
  const pages = runs ? Math.max(1, runs.pages ?? Math.ceil(runs.total / Math.max(1, runs.limit))) : 1;
  const currentPage = runs?.page ?? page;
  return <section className="ops-panel space-y-4 p-5">
    <h2 className="font-semibold text-ops-text">{t("title")}</h2>
    <p className="text-sm text-ops-muted">{t("hint")}</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
      event.preventDefault();
      perform(async () => {
        const result = await startEpdrLocalPlaybook({
          versionId: Number(versionId), detectionId: Number(detectionId), mode: "local", confirmLocalReview: true,
        });
        if ("message" in result) { setError(true); return; }
        setFeedback(result.existing ? t("existing", { id: result.runId }) : t("started", { id: result.runId }));
        setPage(1);
        setRevision((value) => value + 1);
        await loadRun(result.runId);
      });
    }}>
      <label className="grid gap-1 text-sm">{t("versionId")}<input required type="number" min={1} value={versionId} onChange={(e) => setVersionId(e.target.value)} className="ops-input px-3 py-2" /></label>
      <label className="grid gap-1 text-sm">{t("detectionId")}<input required type="number" min={1} value={detectionId} onChange={(e) => setDetectionId(e.target.value)} className="ops-input px-3 py-2" /></label>
      <label className="flex max-w-md items-start gap-2 text-xs text-ops-muted">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
        {t("confirm")}
      </label>
      <button disabled={pending || !confirmed} className="rounded-md bg-ops-accent px-3 py-2 text-sm text-ops-bg disabled:opacity-50">{t("start")}</button>
    </form>
    {feedback && <p role="status" className="text-sm text-ops-text">{feedback}</p>}
    {error && <p role="alert" className="text-sm text-ops-danger">{t("error")}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={pending} onClick={() => setRevision((value) => value + 1)} className="text-sm text-ops-accent">{t("refresh")}</button>
      {detail && <button type="button" disabled={pending} onClick={() => perform(async () => {
        const result = await resumeEpdrLocalPlaybook(detail.id);
        if ("message" in result) { setError(true); return; }
        setFeedback(t(`resume_${result.result}`));
        setRevision((value) => value + 1);
        await loadRun(detail.id);
      })} className="text-sm text-ops-accent">{t("resume")}</button>}
    </div>
    {!runs ? !error && <p className="text-sm text-ops-muted">{t("loading")}</p> : <>
      <p className="text-sm text-ops-muted">{t("pageSummary", { page: currentPage, pages, total: runs.total })}</p>
      <ul className="divide-y divide-ops-border">
        {runs.rows.map((run: LocalPlaybookRunSummary) => <li key={run.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <span>{t("row", { id: run.id, version: run.versionId, detection: run.detectionId })}</span>
          <span className="text-ops-muted">{t(`status.${run.status}`)}</span>
          <button type="button" disabled={pending} onClick={() => openRun(run.id)} className="text-ops-accent">{t("inspect")}</button>
        </li>)}
      </ul>
      {runs.rows.length === 0 && <p className="text-sm text-ops-muted">{t("empty")}</p>}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" className="text-ops-accent disabled:opacity-50" disabled={pending || currentPage <= 1} onClick={() => setPage(currentPage - 1)}>{t("previous")}</button>
        <button type="button" className="text-ops-accent disabled:opacity-50" disabled={pending || currentPage >= pages} onClick={() => setPage(currentPage + 1)}>{t("next")}</button>
      </div>
    </>}
    {detail && <div className="space-y-2 rounded-md border border-ops-border p-4">
      <p className="text-sm font-medium">{t("detail", { id: detail.id })} · {t(`status.${detail.status}`)}</p>
      <p className="text-xs text-ops-muted">{t("finishedNote")}</p>
      <ol className="space-y-1 text-sm">
        {detail.steps.map((step) => <li key={step.ordinal} className="flex flex-wrap gap-2">
          <span className="text-ops-text">{step.ordinal}. {t(`steps.${step.kind}`)}</span>
          <span className="text-ops-muted">{t(`outcomes.${step.status}`)}</span>
          {step.reason && <span className="font-mono text-[11px] text-ops-subtle">{step.reason}</span>}
        </li>)}
      </ol>
      {intents.length > 0 && <div className="space-y-2 border-t border-ops-border pt-2">
        <p className="text-xs text-ops-muted">{t("approvalHint")}</p>
        <div className="flex flex-wrap gap-2">
          {intents.map((intent) => <button key={intent} type="button" disabled={pending} onClick={() => perform(async () => {
            const result = await requestEpdrLocalApproval({ runId: detail.id, actionIntent: intent, confirmLocalApproval: true });
            if ("message" in result) { setError(true); return; }
            setFeedback(t("approvalRequested", { id: result.approvalId }));
          })} className="rounded-md border border-ops-border px-3 py-2 text-sm text-ops-text disabled:opacity-50">{t(`request_${intent}`)}</button>)}
        </div>
      </div>}
    </div>}
  </section>;
}
