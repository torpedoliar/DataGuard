"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  approveEpdrExecutionRequest,
  createEpdrExecutionRequest,
  getEpdrExecutionOptions,
  getEpdrExecutionRequest,
  getEpdrExecutionRequests,
  rejectEpdrExecutionRequest,
  resolveEpdrExecutionReview,
  type ExecutionErrorCode,
  type ExecutionOptions,
  type ExecutionRequestDetail,
  type ExecutionRequestSummary,
} from "@/actions/epdr-executions";

type RequestPage = { rows: ExecutionRequestSummary[]; page: number; pages: number; total: number };
type Params = Record<string, string>;

const HIGH_IMPACT_PARAMS: Record<string, string[]> = {
  reboot: ["count_down_type"],
  assign_config: ["config_id"],
  ts_kill_process: ["pid", "md5"],
  ts_quarantine: ["md5"],
  ts_block_ip: ["address"],
  ts_unblock_ip: ["address"],
  ts_incident_status: ["status"],
};

function buildParameters(actionType: string, params: Params): Record<string, unknown> | undefined {
  const keys = HIGH_IMPACT_PARAMS[actionType] ?? [];
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const raw = (params[key] ?? "").trim();
    if (!raw) continue;
    if (key === "count_down_type") out[key] = Number(raw);
    else out[key] = raw;
  }
  if (actionType === "scan" && params.scan_scope) out.scan_scope = Number(params.scan_scope);
  return Object.keys(out).length > 0 ? out : undefined;
}

type Prefill = { endpointId?: number; actionType?: string };

/**
 * Request → approve → worker result. Write gates live in EPDR settings; a
 * prefill only preselects the form and still needs the explicit confirmation.
 */
export default function ExecutionCenter({ locale = "en", prefill = {} }: { locale?: string; prefill?: Prefill } = {}) {
  const t = useTranslations("Epdr.execution");
  const [options, setOptions] = useState<ExecutionOptions | null>(null);
  const [page, setPage] = useState<RequestPage | null>(null);
  const [detail, setDetail] = useState<ExecutionRequestDetail | null>(null);
  const [error, setError] = useState<ExecutionErrorCode | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [revision, setRevision] = useState(0);
  const [listPage, setListPage] = useState(1);

  const [endpointId, setEndpointId] = useState("");
  const [actionType, setActionType] = useState("");
  const [params, setParams] = useState<Params>({});
  const [confirmed, setConfirmed] = useState(false);
  const [approveConfirm, setApproveConfirm] = useState(false);
  const [resolveNote, setResolveNote] = useState("");

  const [prefillApplied, setPrefillApplied] = useState(false);

  const mounted = useRef(true);
  const detailRequest = useRef(0);
  // Consumed (set to null) the first time options load, so polling never re-applies it.
  const pendingPrefill = useRef<Prefill | null>(prefill.endpointId !== undefined || prefill.actionType !== undefined ? prefill : null);

  // StrictMode replays setup → cleanup → setup. The ref must be restored on
  // every setup or the component ignores results after the replay.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      detailRequest.current += 1;
    };
  }, []);

  useEffect(() => {
    let active = true;
    getEpdrExecutionOptions().then((result) => {
      if (!active) return;
      if ("code" in result) { setError(result.code); setErrorReason(result.reason ?? null); }
      else {
        setOptions(result);
        // Apply a prefill once, and only for values the loaded options offer.
        const wanted = pendingPrefill.current;
        if (wanted) {
          pendingPrefill.current = null;
          const endpoint = wanted.endpointId !== undefined && result.endpoints.some((entry) => entry.id === wanted.endpointId);
          const action = wanted.actionType !== undefined && result.actions.some((entry) => entry.actionType === wanted.actionType);
          if (endpoint) setEndpointId(String(wanted.endpointId));
          if (action) setActionType(wanted.actionType!);
          setPrefillApplied(endpoint || action);
        }
      }
    }).catch(() => { if (active) setError("service_unavailable"); });
    return () => { active = false; };
  }, [revision]);

  useEffect(() => {
    let active = true;
    getEpdrExecutionRequests({ page: listPage }).then((result) => {
      if (!active) return;
      if ("code" in result) { setPage(null); setError(result.code); setErrorReason(result.reason ?? null); }
      else {
        setPage(result);
        if (result.page !== listPage) setListPage(result.page);
      }
    }).catch(() => { if (active) setError("service_unavailable"); });
    return () => { active = false; };
  }, [revision, listPage]);

  // Monitoring: statuses change in the worker, not in this tab.
  useEffect(() => {
    const timer = setInterval(() => setRevision((value) => value + 1), 20_000);
    return () => clearInterval(timer);
  }, []);

  function perform(operation: () => Promise<void>) {
    startTransition(async () => {
      if (mounted.current) { setError(null); setErrorReason(null); }
      try { await operation(); } catch { if (mounted.current) setError("service_unavailable"); }
    });
  }

  async function loadDetail(requestId: number) {
    const request = ++detailRequest.current;
    setDetail(null);
    setApproveConfirm(false);
    setResolveNote("");
    const data = await getEpdrExecutionRequest(requestId);
    if (!mounted.current || request !== detailRequest.current) return;
    if ("code" in data) { setError(data.code); setErrorReason(data.reason ?? null); }
    else setDetail(data);
  }

  const selectedAction = options?.actions.find((entry) => entry.actionType === actionType);
  const paramKeys = HIGH_IMPACT_PARAMS[actionType] ?? [];
  const canSubmit = Boolean(options?.writeEnabled && endpointId && actionType && confirmed);
  const prefilled = prefillApplied && (endpointId !== "" || actionType !== "");

  return <section className="ops-panel space-y-5 p-5">
    <div>
      <h2 className="font-semibold text-ops-text">{t("title")}</h2>
      <p className="mt-1 max-w-4xl text-sm leading-6 text-ops-muted">{t("hint")}</p>
    </div>

    {options && <div className="rounded-md border border-ops-border bg-ops-surface-raised p-3 text-sm">
      <p className="font-medium text-ops-text">
        {options.writeEnabled ? t("enabled") : t("disabled")}
      </p>
      {options.disabledReasons.length > 0 && <ul className="mt-2 list-inside list-disc text-xs text-ops-muted">
        {options.disabledReasons.map((reason) => <li key={reason}>{t(`reasons.${reason}` as never)}</li>)}
      </ul>}
      {!options.writeEnabled && <Link href={`/${locale}/admin/epdr/settings#provider-execution`} className="mt-2 inline-block text-xs text-ops-accent underline">{t("settingsLink")}</Link>}
      <p className="mt-2 text-xs text-ops-muted">{t("approvalWindow", { minutes: options.approvalExpiryMinutes })}</p>
      <p className="mt-1 text-xs text-ops-muted">
        {t("effectiveLimits", { cap: options.limits.maxActionsPerHour, minutes: options.limits.cooldownMinutes })}
      </p>
    </div>}

    {error && <p role="alert" className="text-sm text-ops-danger">
      {t(`errors.${error}` as never)}
      {errorReason && <span className="ml-2 text-xs text-ops-muted">({t("reason", { reason: errorReason })})</span>}
    </p>}
    {feedback && <p role="status" className="text-sm text-ops-text">{feedback}</p>}
    {prefilled && <p role="status" className="text-xs text-ops-muted">{t("prefilled")}</p>}

    <form className="grid gap-3 rounded-md border border-ops-border p-4 lg:grid-cols-2" onSubmit={(event) => {
      event.preventDefault();
      perform(async () => {
        const result = await createEpdrExecutionRequest({
          endpointId: Number(endpointId),
          actionType,
          parameters: buildParameters(actionType, params),
          confirmExecutionRequest: true,
        });
        if (!mounted.current) return;
        if ("code" in result) { setError(result.code); setErrorReason(result.reason ?? null); return; }
        setFeedback(t("requested", { id: result.requestId }));
        setConfirmed(false);
        setListPage(1);
        setRevision((value) => value + 1);
        await loadDetail(result.requestId);
      });
    }}>
      <label className="grid gap-1.5 text-sm text-ops-text">{t("endpoint")}
        <select required value={endpointId} disabled={!options} onChange={(event) => { setEndpointId(event.target.value); setConfirmed(false); }} className="ops-input px-3 py-2">
          <option value="">{options ? t("selectEndpoint") : t("loading")}</option>
          {(options?.endpoints ?? []).map((endpoint) => <option key={endpoint.id} value={endpoint.id}>
            {t("endpointOption", { id: endpoint.id, host: endpoint.hostName ?? t("unknownHost") })}
            {endpoint.hold ? ` ${t("endpointHold")}` : ""}
            {endpoint.dataFresh ? "" : ` ${t("endpointStale")}`}
          </option>)}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm text-ops-text">{t("action")}
        <select required value={actionType} disabled={!options?.writeEnabled} onChange={(event) => { setActionType(event.target.value); setParams({}); setConfirmed(false); }} className="ops-input px-3 py-2">
          <option value="">{t("selectAction")}</option>
          {(options?.actions ?? []).map((entry) => <option key={entry.actionType} value={entry.actionType}>
            {t(`actions.${entry.actionType}` as never)}
          </option>)}
        </select>
      </label>
      {selectedAction && <div className="space-y-1 lg:col-span-2 text-xs text-ops-muted">
        <p>{selectedAction.highImpact ? t("impactHigh") : t("impactStandard")} · {t(`namespace.${selectedAction.namespace}` as never)}</p>
        <p>{selectedAction.observationSupport === "automatic" ? t("observationAutomatic") : t("observationManual")}</p>
      </div>}
      {actionType === "scan" && <label className="grid gap-1.5 text-sm text-ops-text">{t("params.scan_scope")}
        <select className="ops-input px-3 py-2" value={params.scan_scope ?? ""} onChange={(event) => { setParams((current) => ({ ...current, scan_scope: event.target.value })); setConfirmed(false); }}>
          <option value="">{t("params.default")}</option>
          <option value="0">{t("params.scanWholeDevice")}</option>
          <option value="1">{t("params.scanCritical")}</option>
        </select>
      </label>}
      {paramKeys.filter((key) => key !== "status").map((key) => <label key={key} className="grid gap-1.5 text-sm text-ops-text">
        {t(`params.${key}` as never)}
        <input className="ops-input px-3 py-2" value={params[key] ?? ""} onChange={(event) => {
          setParams((current) => ({ ...current, [key]: event.target.value }));
          setConfirmed(false);
        }} />
      </label>)}
      {paramKeys.includes("status") && <label className="grid gap-1.5 text-sm text-ops-text">{t("params.status")}
        <select className="ops-input px-3 py-2" value={params.status ?? ""} onChange={(event) => { setParams((current) => ({ ...current, status: event.target.value })); setConfirmed(false); }}>
          <option value="">{t("params.default")}</option>
          {["new", "read", "closed"].map((value) => <option key={value} value={value}>{t(`status.${value}` as never)}</option>)}
        </select>
      </label>}
      <label className="flex items-start gap-2 text-xs leading-5 text-ops-muted lg:col-span-2">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5" />
        {t("confirmRequest")}
      </label>
      <div className="lg:col-span-2">
        <button disabled={pending || !canSubmit} className="rounded-md bg-ops-accent px-3 py-2 text-sm font-medium text-ops-bg disabled:opacity-50">{t("request")}</button>
      </div>
    </form>

    <div className="border-t border-ops-border pt-3">
      <h3 className="text-sm font-medium text-ops-text">{t("listTitle")}</h3>
      {!page ? !error && <p className="mt-2 text-sm text-ops-muted">{t("loading")}</p> : <>
        <p className="mt-2 text-sm text-ops-muted">{t("pageSummary", { page: page.page, pages: page.pages, total: page.total })}</p>
        <ul className="divide-y divide-ops-border">
          {page.rows.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <span>{t("row", { id: row.id })} · {t(`actions.${row.actionType}` as never)}</span>
            <span className="text-ops-muted">{t(`state.${row.state}` as never)}</span>
            {row.state === "pending_approval" && <button type="button" disabled={pending} onClick={() => perform(async () => {
              const result = await rejectEpdrExecutionRequest({ requestId: row.id });
              if (!mounted.current) return;
              if ("code" in result) { setError(result.code); setErrorReason(result.reason ?? null); return; }
              setFeedback(t("rejected", { id: row.id }));
              setRevision((value) => value + 1);
            })} className="text-ops-muted disabled:opacity-50">{t("reject")}</button>}
            <button type="button" disabled={pending} onClick={() => perform(() => loadDetail(row.id))} className="text-ops-accent">{t("inspect")}</button>
          </li>)}
        </ul>
        {page.rows.length === 0 && <p className="text-sm text-ops-muted">{t("empty")}</p>}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button type="button" className="text-ops-accent disabled:opacity-50" disabled={pending || page.page <= 1} onClick={() => setListPage(page.page - 1)}>{t("previous")}</button>
          <button type="button" className="text-ops-accent disabled:opacity-50" disabled={pending || page.page >= page.pages} onClick={() => setListPage(page.page + 1)}>{t("next")}</button>
          <button type="button" className="text-ops-accent disabled:opacity-50" disabled={pending} onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</button>
        </div>
      </>}
    </div>

    {detail && <div className="space-y-3 rounded-md border border-ops-border p-4">
      <p className="text-sm font-medium text-ops-text">{t("detail", { id: detail.id })} · {t(`state.${detail.state}` as never)}</p>
      <p className="text-sm text-ops-muted">{t(`stateHint.${detail.state}` as never)}</p>
      {detail.outcomeUnknownReason && <p className="text-sm text-ops-warning">{t("outcomeUnknown", { reason: detail.outcomeUnknownReason })}</p>}
      {detail.reviewReason && <p className="text-sm text-ops-warning">{t("reviewReason", { reason: detail.reviewReason })}</p>}

      <dl className="grid gap-2 rounded-md border border-ops-border bg-ops-surface-raised p-3 text-xs text-ops-muted sm:grid-cols-2">
        <div><dt className="font-medium text-ops-text">{t("targetEndpoint")}</dt><dd>{t("endpointOption", { id: detail.endpointId, host: options?.endpoints.find((entry) => entry.id === detail.endpointId)?.hostName ?? t("unknownHost") })}</dd></div>
        <div><dt className="font-medium text-ops-text">{t("targetNamespace")}</dt><dd>{detail.namespace ? t(`namespace.${detail.namespace}` as never) : "—"}</dd></div>
        <div><dt className="font-medium text-ops-text">{t("targetDevice")}</dt><dd className="break-all">{detail.target.deviceId ?? "—"}</dd></div>
        <div><dt className="font-medium text-ops-text">{t("targetEntity")}</dt><dd className="break-all">{detail.target.entityId ?? "—"}</dd></div>
        <div><dt className="font-medium text-ops-text">{t("targetIncident")}</dt><dd className="break-all">{detail.target.providerIncidentId ?? "—"}</dd></div>
        <div><dt className="font-medium text-ops-text">{t("revisions")}</dt><dd>{t("revisionValues", {
          account: detail.accountRevision ?? "—", credential: detail.credentialRevision ?? "—", evidence: detail.evidenceGeneration ?? "—",
        })}</dd></div>
        <div><dt className="font-medium text-ops-text">{t("parameters")}</dt><dd className="break-all">{JSON.stringify(detail.parameters ?? {})}</dd></div>
        <div><dt className="font-medium text-ops-text">{t("expires")}</dt><dd>{detail.expiresAt ? new Date(detail.expiresAt).toLocaleString(locale) : "—"}</dd></div>
      </dl>

      {detail.state === "pending_approval" && <div className="space-y-2 border-t border-ops-border pt-3">
        <p className="text-xs text-ops-muted">{t("approveHint")}</p>
        <label className="flex items-start gap-2 text-xs leading-5 text-ops-muted">
          <input type="checkbox" checked={approveConfirm} onChange={(event) => setApproveConfirm(event.target.checked)} className="mt-0.5" />
          {t("approveConfirm")}
        </label>
        <button type="button" disabled={pending || !approveConfirm} onClick={() => perform(async () => {
          const result = await approveEpdrExecutionRequest({ requestId: detail.id, confirmApproval: true });
          if (!mounted.current) return;
          if ("code" in result) { setError(result.code); setErrorReason(result.reason ?? null); return; }
          setFeedback(t("approved", { id: detail.id }));
          setApproveConfirm(false);
          setRevision((value) => value + 1);
          await loadDetail(detail.id);
        })} className="rounded-md bg-ops-accent px-3 py-2 text-sm font-medium text-ops-bg disabled:opacity-50">{t("approve")}</button>
      </div>}

      {detail.state === "needs_review" && <div className="space-y-2 border-t border-ops-border pt-3">
        <p className="text-xs text-ops-muted">{t("resolveHint")}</p>
        <input className="ops-input w-full px-3 py-2 text-sm" maxLength={200} value={resolveNote} onChange={(event) => setResolveNote(event.target.value)} placeholder={t("resolveNote")} />
        <button type="button" disabled={pending || resolveNote.trim().length < 3} onClick={() => perform(async () => {
          const result = await resolveEpdrExecutionReview({ requestId: detail.id, note: resolveNote.trim(), confirmResolve: true });
          if (!mounted.current) return;
          if ("code" in result) { setError(result.code); setErrorReason(result.reason ?? null); return; }
          setFeedback(t("resolved", { id: detail.id }));
          setResolveNote("");
          setRevision((value) => value + 1);
          await loadDetail(detail.id);
        })} className="rounded-md border border-ops-border px-3 py-2 text-sm text-ops-text disabled:opacity-50">{t("resolve")}</button>
      </div>}

      <p className="text-xs text-ops-muted">{t("detailMeta", {
        requestedBy: detail.requestedBy ?? "-",
        approvedBy: detail.approvedBy ?? "-",
        created: new Date(detail.createdAt).toLocaleString(locale),
      })}</p>
      {detail.approvalExpiresAt && <p className="text-xs text-ops-muted">{t("expires", { time: new Date(detail.approvalExpiresAt).toLocaleString(locale) })}</p>}
      <details className="rounded-md border border-ops-border p-3 text-sm">
        <summary className="cursor-pointer font-medium text-ops-text">{t("technical")}</summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-ops-surface-raised p-3 text-[11px] text-ops-muted">{JSON.stringify({
          parameters: detail.parameters, snapshotHash: detail.snapshotHash, providerRef: detail.providerRef, attempts: detail.attempts,
        }, null, 2)}</pre>
      </details>
    </div>}
  </section>;
}
