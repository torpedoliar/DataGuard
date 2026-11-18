"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  getEpdrLocalPlaybookOptions, getEpdrLocalPlaybookRun, getEpdrLocalPlaybookRuns,
  resumeEpdrLocalPlaybook, startEpdrLocalPlaybook,
  type LocalPlaybookError, type LocalPlaybookOptions, type LocalPlaybookRunDetail,
  type LocalPlaybookRunSummary,
} from "@/actions/epdr-local-playbooks";
import { requestEpdrLocalApproval } from "@/actions/epdr-local-approvals";
import { LOCAL_REVIEW_CAPABILITIES } from "@/lib/epdr/local-capabilities";
import PlaybookVersionForm from "./playbook-version-form";
import IncidentHandoff from "./incident-handoff";

type RunList = Exclude<Awaited<ReturnType<typeof getEpdrLocalPlaybookRuns>>, { message: string }>;
type ApprovalIntent = "scan" | "isolate";
type ErrorCode = LocalPlaybookError["code"] | null;

/** The saved recommendation, not a selector, decides which local decisions are available. */
function reviewPolicy(evidence: unknown): { status?: string; reasons?: string[] } {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return {};
  const policy = (evidence as Record<string, unknown>).responsePolicy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return {};
  const value = policy as Record<string, unknown>;
  return { status: typeof value.status === "string" ? value.status : undefined,
    reasons: Array.isArray(value.reasons) ? value.reasons.filter((reason): reason is string => typeof reason === "string") : [] };
}
function proposedIntents(evidence: unknown): ApprovalIntent[] {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
  const record = evidence as Record<string, unknown>;
  const definition = record.definition as { template?: { steps?: unknown } } | undefined;
  const steps = definition?.template?.steps;
  if (reviewPolicy(evidence).status !== "proposed" || !Array.isArray(steps)) return [];
  return (["scan", "isolate"] as const).filter((intent) => steps.includes(intent));
}

const STAGE_KEYS = ["chooseDetection", "chooseVersion", "createReview", "recordReview"] as const;

export default function LocalPlaybookRunner({ initialDetectionId, locale = "en" }: { initialDetectionId?: number; locale?: string } = {}) {
  const t = useTranslations("Epdr.localRunV2");
  const [runs, setRuns] = useState<RunList | null>(null);
  const [options, setOptions] = useState<LocalPlaybookOptions | null>(null);
  const [detail, setDetail] = useState<LocalPlaybookRunDetail | null>(null);
  const [detectionId, setDetectionId] = useState(initialDetectionId ? String(initialDetectionId) : "");
  const [versionId, setVersionId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<ErrorCode>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [revision, setRevision] = useState(0);
  const [optionsRevision, setOptionsRevision] = useState(0);
  const [page, setPage] = useState(1);
  const mounted = useRef(true);
  const detailRequest = useRef(0);

  useEffect(() => () => { mounted.current = false; detailRequest.current += 1; }, []);
  useEffect(() => {
    let active = true;
    getEpdrLocalPlaybookRuns({ page }).then((data) => {
      if (!active) return;
      if ("message" in data) { setRuns(null); setError("service_unavailable"); }
      else {
        setRuns(data); setError(null);
        const currentPage = data.page ?? 1;
        if (currentPage !== page) setPage(currentPage);
      }
    }).catch(() => { if (active) { setRuns(null); setError("service_unavailable"); } });
    return () => { active = false; };
  }, [revision, page]);
  useEffect(() => {
    let active = true;
    // Eligibility is recomputed whenever the selection pair changes; a guard
    // then drops selections a refresh removed (new revision, redefined
    // version) instead of submitting them.
    getEpdrLocalPlaybookOptions({
      ...(initialDetectionId ? { detectionId: Number(initialDetectionId) } : {}),
      ...(detectionId !== "" && versionId !== ""
        ? { detectionId: Number(detectionId), versionId: Number(versionId) } : {}),
    }).then((result) => {
      if (!active) return;
      if ("code" in result) setError(result.code);
      else {
        setOptions(result);
        if (versionId !== "" && !result.versions.some((item) => String(item.id) === versionId && item.compatible)) {
          setVersionId("");
          setConfirmed(false);
        }
        if (detectionId !== "" && !initialDetectionId
          && !result.detections.some((item) => String(item.id) === detectionId)
          && !(result.requestedDetection && String(result.requestedDetection.id) === detectionId)) {
          setDetectionId("");
          setConfirmed(false);
        }
        if (initialDetectionId && result.requestedDetectionUnavailable) setDetectionId("");
      }
    }).catch(() => { if (active) setError("service_unavailable"); });
    return () => { active = false; };
  }, [initialDetectionId, optionsRevision, detectionId, versionId]);

  function perform(operation: () => Promise<void>) {
    startTransition(async () => {
      if (mounted.current) setError(null);
      try { await operation(); } catch { if (mounted.current) setError("service_unavailable"); }
    });
  }
  async function loadRun(runId: number) {
    const request = ++detailRequest.current;
    setDetail(null);
    const data = await getEpdrLocalPlaybookRun(runId);
    if (!mounted.current || request !== detailRequest.current) return;
    if ("message" in data) setError("service_unavailable");
    else setDetail(data);
  }
  function refreshChoices() {
    setError(null);
    setOptionsRevision((value) => value + 1);
  }

  const detections = options ? [...options.detections, ...(options.requestedDetection && !options.detections.some((item) => item.id === options.requestedDetection?.id) ? [options.requestedDetection] : [])] : [];
  const selectedDetection = detections.find((item) => String(item.id) === detectionId);
  const intents = detail ? proposedIntents(detail.evidence) : [];
  const policy = detail ? reviewPolicy(detail.evidence) : {};
  const pages = runs ? Math.max(1, runs.pages ?? Math.ceil(runs.total / Math.max(1, runs.limit))) : 1;
  const currentPage = runs?.page ?? page;
  const compatibleVersions = options?.versions.filter((item) => item.compatible) ?? [];
  const incompatibleVersions = options?.versions.filter((item) => !item.compatible) ?? [];
  const eligibility = options?.eligibility ?? null;
  // Four-stage flow: the indicator marks where the operator currently is.
  const stage = detail ? 3 : versionId !== "" ? 2 : detectionId !== "" ? 1 : 0;
  return <section className="ops-panel space-y-5 p-5">
    <div>
      <h2 className="font-semibold text-ops-text">{t("title")}</h2>
      <p className="mt-1 max-w-4xl text-sm leading-6 text-ops-muted">{t("hint")}</p>
    </div>
    <ol className="grid gap-2 text-xs text-ops-muted sm:grid-cols-2 xl:grid-cols-4">
      {STAGE_KEYS.map((step, index) => <li key={step} aria-current={index === stage ? "step" : undefined}
        className={`flex items-center gap-2 rounded-md border px-3 py-2 ${index === stage
          ? "border-ops-accent bg-ops-surface-raised text-ops-text" : "border-ops-border bg-ops-surface-raised"}`}>
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-ops-border font-semibold text-ops-accent">{index + 1}</span>{t(`stages.${step}`)}
      </li>)}
    </ol>
    <p className="text-xs text-ops-muted">{t("capabilityNotice", {
      provider: t(`capability.${LOCAL_REVIEW_CAPABILITIES.providerAction.availability}`),
      notification: t(`capability.${LOCAL_REVIEW_CAPABILITIES.notification.availability}`),
    })}</p>
    <form className="grid items-end gap-4 rounded-md border border-ops-border p-4 lg:grid-cols-2" onSubmit={(event) => {
      event.preventDefault();
      perform(async () => {
        const result = await startEpdrLocalPlaybook({
          versionId: Number(versionId), detectionId: Number(detectionId), mode: "local", confirmLocalReview: true,
        });
        if (!mounted.current) return;
        if ("code" in result) { setError(result.code); return; }
        setFeedback(result.existing ? t("existing", { id: result.runId }) : t("started", { id: result.runId }));
        setConfirmed(false); setPage(1); setRevision((value) => value + 1);
        await loadRun(result.runId);
      });
    }}>
      <label className="grid gap-1.5 text-sm text-ops-text">{t("detection")}
        <select required aria-label={t("detection")} value={detectionId} disabled={!options} onChange={(event) => { setDetectionId(event.target.value); setConfirmed(false); }} className="ops-input px-3 py-2">
          <option value="">{options ? t("selectDetection") : t("loadingOptions")}</option>
          {detections.map((item) => <option key={item.id} value={item.id}>{t("detectionOption", { id: item.id, threat: item.threatName ?? item.category, host: item.hostName ?? t("unknownHost") })}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm text-ops-text">{t("version")}
        <select required aria-label={t("version")} value={versionId} disabled={!options} onChange={(event) => { setVersionId(event.target.value); setConfirmed(false); }} className="ops-input px-3 py-2">
          <option value="">{options ? t("selectVersion") : t("loadingOptions")}</option>
          {compatibleVersions.map((item) => <option key={item.id} value={item.id}>{t("versionOption", { name: item.name, version: item.version, template: item.templateId ?? "" })}</option>)}
        </select>
      </label>
      <div className="grid gap-2 text-xs text-ops-muted lg:col-span-2">
        {options && options.versions.length > 0 && incompatibleVersions.length > 0 && <p>
          {t("incompatibleNote", { count: incompatibleVersions.length })}
          {incompatibleVersions.map((item) => <span key={item.id} className="block pl-3">
            #{item.id} · {t(`compatibility.${item.incompatibilityReason}`)}
          </span>)}
        </p>}
        {options?.versionsTruncated && <p>{t("versionsLimited")}</p>}
        {options && !compatibleVersions.length && <p>{t("noVersions")}</p>}
        {options && !options.detections.length && !options.requestedDetection && <p>{t("noDetections")}</p>}
        {options?.requestedDetectionUnavailable && <p className="text-ops-warning">{t("requestedUnavailable")}</p>}
        {options?.detectionTruncated && <p>{t("detectionsLimited")}</p>}
        {selectedDetection && <p>{t("selectedDetection", { category: selectedDetection.category, score: selectedDetection.score ?? t("missingScore"), time: new Date(selectedDetection.detectedAt).toLocaleString(locale) })}</p>}
        <p>{t("selectorNote")}</p>
      </div>
      {/* Pre-create eligibility: what a start would evaluate, shown before the create step. */}
      {eligibility && <div aria-live="polite" className="rounded-md border border-ops-border bg-ops-surface-raised p-3 text-xs lg:col-span-2">
        <p className="font-medium text-ops-text">{t("eligibility.title")}</p>
        {eligibility.blocker && <p className="mt-1 text-ops-warning">{t(`eligibility.blocker.${eligibility.blocker}`)}</p>}
        {!eligibility.blocker && eligibility.versionCompatible && <p className="mt-1">{t("eligibility.ok")}</p>}
        {eligibility.blocker === null && eligibility.versionCompatible && eligibility.policy && <>
          <p className="mt-1">{t("eligibility.policy", { status: t(`policy.${eligibility.policy.status}`) })}</p>
          {eligibility.policy.reasons.length > 0 && <ul className="mt-1 list-inside list-disc">
            {eligibility.policy.reasons.map((reason) => <li key={reason}>{t(`reasons.${reason}`)}</li>)}
          </ul>}
        </>}
        {eligibility.endpointFacts && <ul className="mt-1 list-inside list-disc">
          <li>{t("eligibility.identity", { known: eligibility.endpointFacts.identityKnown ? t("yes") : t("no") })}</li>
          <li>{t("eligibility.hold", { hold: eligibility.endpointFacts.hold ? t("yes") : t("no") })}</li>
          <li>{t("eligibility.completeness", { status: t(`eligibility.completeness_${eligibility.endpointFacts.sourceCompleteness}`) })}</li>
        </ul>}
      </div>}
      <label className="flex items-start gap-2 text-xs leading-5 text-ops-muted lg:col-span-2">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5" />
        {t("confirm")}
      </label>
      <div className="flex flex-wrap gap-3 lg:col-span-2">
        <button disabled={pending || !confirmed || !versionId || !detectionId} className="rounded-md bg-ops-accent px-3 py-2 text-sm font-medium text-ops-bg disabled:opacity-50">{t("start")}</button>
        <button type="button" disabled={pending} onClick={refreshChoices} className="rounded-md border border-ops-border px-3 py-2 text-sm text-ops-text disabled:opacity-50">{t("refreshChoices")}</button>
      </div>
    </form>
    {/* Inline authoring: a missing or unusable version is solved here, not in another panel. */}
    {options && !compatibleVersions.length && <div className="rounded-md border border-ops-border p-4">
      <p className="text-sm font-medium text-ops-text">{t("authoringTitle")}</p>
      <p className="mt-1 text-xs text-ops-muted">{t("authoringHint")}</p>
      <div className="mt-3">
        <PlaybookVersionForm onSaved={(saved) => {
          setFeedback(t("versionSaved", { id: saved.id, version: saved.version }));
          setVersionId(String(saved.id));
          refreshChoices();
        }} />
      </div>
    </div>}
    {feedback && <p role="status" className="text-sm text-ops-text">{feedback}</p>}
    {error && <p role="alert" className="text-sm text-ops-danger">{t(`errors.${error}`)}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={pending} onClick={() => { setError(null); setRevision((value) => value + 1); }} className="text-sm text-ops-accent">{t("refresh")}</button>
      {detail?.status === "pending" && <button type="button" disabled={pending} onClick={() => perform(async () => {
        const result = await resumeEpdrLocalPlaybook(detail.id);
        if (!mounted.current) return;
        if ("message" in result) { setError("service_unavailable"); return; }
        setFeedback(t(`resume_${result.result}`)); setRevision((value) => value + 1);
        await loadRun(detail.id);
      })} className="rounded-md bg-ops-accent px-3 py-2 text-sm font-medium text-ops-bg disabled:opacity-50">{t("resume")}</button>}
    </div>
    {detail && <div className="space-y-4 rounded-md border border-ops-border p-4">
      <div>
        <p className="text-sm font-medium text-ops-text">{t("detail", { id: detail.id })} · {t(`status.${detail.status}`)}</p>
        <p className="mt-1 text-sm leading-5 text-ops-muted">{t(`statusHint.${detail.status}`)}</p>
      </div>
      {(policy.status === "proposed" || policy.status === "blocked") && <div className="rounded-md border border-ops-border bg-ops-surface-raised p-3 text-sm">
        <p className="font-medium text-ops-text">{t("savedPolicy")} · {t(`policy.${policy.status}`)}</p>
        <p className="mt-1 text-xs text-ops-muted">{t("policyNote")}</p>
        {policy.reasons && policy.reasons.length > 0 && <ul className="mt-2 list-inside list-disc text-xs text-ops-muted">
          {policy.reasons.map((reason) => <li key={reason}>{t(`reasons.${reason}`)}</li>)}
        </ul>}
      </div>}
      <ol className="space-y-2 text-sm">
        {detail.steps.map((step) => <li key={step.ordinal} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-ops-border px-3 py-2">
          <span className="text-ops-text">{step.ordinal}. {t(`steps.${step.kind}`)}</span>
          <span className="text-ops-muted">{t(`outcomes.${step.status}`)}</span>
          {step.reason && <span className="text-xs text-ops-muted">{t(`outcomeReasons.${step.reason}`)}</span>}
        </li>)}
      </ol>
      <details className="rounded-md border border-ops-border p-3 text-sm">
        <summary className="cursor-pointer font-medium text-ops-text">{t("technicalEvidence")}</summary>
        <p className="mt-2 text-xs text-ops-muted">{t("finishedNote")}</p>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md bg-ops-surface-raised p-3 text-[11px] text-ops-muted">{JSON.stringify({ evidence: detail.evidence, steps: detail.steps }, null, 2)}</pre>
      </details>
      <div className="space-y-2 border-t border-ops-border pt-3">
        <p className="text-sm font-medium text-ops-text">{t("nextActions")}</p>
        <p className="text-xs text-ops-muted">{t("nextActionsHint")}</p>
        <IncidentHandoff detectionId={detail.detectionId} locale={locale} />
      </div>
      {intents.length > 0 && <div className="space-y-2 border-t border-ops-border pt-3">
        <p className="text-xs text-ops-muted">{t("approvalHint")}</p>
        <div className="flex flex-wrap gap-2">
          {intents.map((intent) => <button key={intent} type="button" disabled={pending} onClick={() => perform(async () => {
            const result = await requestEpdrLocalApproval({ runId: detail.id, actionIntent: intent, confirmLocalApproval: true });
            if (!mounted.current) return;
            if ("message" in result) { setError("service_unavailable"); return; }
            setFeedback(t("approvalRequested", { id: result.approvalId }));
          })} className="rounded-md border border-ops-border px-3 py-2 text-sm text-ops-text disabled:opacity-50">{t(`request_${intent}`)}</button>)}
        </div>
      </div>}
    </div>}
    <div className="border-t border-ops-border pt-3">
      <h3 className="text-sm font-medium text-ops-text">{t("historyTitle")}</h3>
      {!runs ? !error && <p className="mt-2 text-sm text-ops-muted">{t("loading")}</p> : <>
        <p className="mt-2 text-sm text-ops-muted">{t("pageSummary", { page: currentPage, pages, total: runs.total })}</p>
        <ul className="divide-y divide-ops-border">
          {runs.rows.map((run: LocalPlaybookRunSummary) => <li key={run.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <span>{t("row", { id: run.id, version: run.versionId, detection: run.detectionId })}</span>
            <span className="text-ops-muted">{t(`status.${run.status}`)}</span>
            <button type="button" disabled={pending} onClick={() => perform(() => loadRun(run.id))} className="text-ops-accent">{t("inspect")}</button>
          </li>)}
        </ul>
        {runs.rows.length === 0 && <p className="text-sm text-ops-muted">{t("empty")}</p>}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button type="button" className="text-ops-accent disabled:opacity-50" disabled={pending || currentPage <= 1} onClick={() => setPage(currentPage - 1)}>{t("previous")}</button>
          <button type="button" className="text-ops-accent disabled:opacity-50" disabled={pending || currentPage >= pages} onClick={() => setPage(currentPage + 1)}>{t("next")}</button>
        </div>
      </>}
    </div>
  </section>;
}
