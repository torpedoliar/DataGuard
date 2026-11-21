"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  createEpdrResponseBinding,
  getEpdrResponseBindings,
  getEpdrResponseRecommendations,
  setEpdrResponseBindingState,
} from "@/actions/epdr-responses";
import { createEpdrExecutionRequest, type ExecutionErrorCode } from "@/actions/epdr-executions";
import { getEpdrPlaybookHistory, type SavedPlaybookVersion } from "@/actions/epdr-playbook-history";
import { formatEpdrDateTime } from "@/lib/epdr/time-zone";
import { useEpdrTimeZone } from "./time-zone-provider";

type Binding = {
  id: number; version_id: number; response: string; state: string; account_revision: number;
  activated_at: string; evaluation_after: string; name: string; template_id: string; version: number;
  current_connection: boolean;
};
type Recommendation = {
  id: number; detection_id: number; endpoint_id: number | null; response: string; status: string;
  created_at: string; reasons: unknown; request_id: number | null;
};
const ERROR_KEYS: Record<ExecutionErrorCode, string> = {
  invalid_input: "errorInvalid", forbidden: "errorForbidden", write_disabled: "errorWriteDisabled",
  action_not_allowed: "errorNotAllowed", connection_unavailable: "errorConnection",
  credentials_missing: "errorCredentials", endpoint_unavailable: "errorEndpoint",
  target_unresolved: "errorEndpoint", blocked: "errorBlocked", duplicate_active_request: "errorDuplicate",
  not_found: "errorStale", state_conflict: "errorStale", service_unavailable: "errorUnavailable",
};

/**
 * Recommendation-only operational bindings. Creating, pausing or reviewing a
 * binding never opens write gates and never sends anything to the provider.
 */
export default function ResponseLibrary() {
  const t = useTranslations("Epdr.responsesV2");
  const locale = useLocale();
  const { timeZone } = useEpdrTimeZone();
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [versions, setVersions] = useState<SavedPlaybookVersion[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [versionId, setVersionId] = useState("");
  const [response, setResponse] = useState<"scan" | "isolate">("scan");
  const [confirmed, setConfirmed] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<number | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [recError, setRecError] = useState(false);
  const [toggleError, setToggleError] = useState(false);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(async () => {
      try {
        const [bound, history, recent] = await Promise.all([
          getEpdrResponseBindings(), getEpdrPlaybookHistory({}), getEpdrResponseRecommendations({}),
        ]);
        if (!("bindings" in bound)) { setState("error"); return; }
        setBindings(bound.bindings);
        if ("versions" in history) setVersions(history.versions);
        // A failed history read is an error, never an empty "no recommendations" state.
        setRecError(!("recommendations" in recent));
        setRecommendations("recommendations" in recent ? recent.recommendations : []);
        setState("ready");
      } catch { setState("error"); }
    });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  function create() {
    setCreateError(null);
    if (!versionId) { setCreateError(t("errorVersion")); return; }
    startTransition(async () => {
      try {
        const result = await createEpdrResponseBinding({
          versionId: Number(versionId), response, confirmRecommendationOnly: true,
        });
        if ("bindingId" in result) { setConfirmed(false); setCreateError(null); refresh(); }
        else setCreateError(t(result.code === "binding_limit" ? "errorLimit" : "errorCreate"));
      } catch { setCreateError(t("errorUnavailable")); }
    });
  }

  function toggle(binding: Binding) {
    setToggleError(false);
    startTransition(async () => {
      try {
        const result = await setEpdrResponseBindingState({
          bindingId: binding.id, state: binding.state === "active" ? "paused" : "active",
        });
        if ("ok" in result) refresh();
        else setToggleError(true);
      } catch { setToggleError(true); }
    });
  }

  function request(recommendation: Recommendation) {
    setRequestError(null);
    startTransition(async () => {
      try {
        const result = await createEpdrExecutionRequest({
          endpointId: recommendation.endpoint_id, actionType: recommendation.response,
          confirmExecutionRequest: true, recommendationId: recommendation.id,
        });
        if ("requestId" in result) { setRequesting(null); refresh(); }
        else setRequestError(t(ERROR_KEYS[result.code]));
      } catch { setRequestError(t("errorUnavailable")); }
    });
  }

  return <section className="space-y-5">
    <div className="ops-panel p-5">
      <h2 className="text-lg font-semibold text-ops-text">{t("title")}</h2>
      <p className="mt-1 max-w-3xl text-sm text-ops-muted">{t("description")}</p>
      {state === "error" && <p role="alert" className="mt-3 text-sm text-ops-danger">{t("error")}</p>}
      {state === "loading" && <p role="status" className="mt-3 text-sm text-ops-muted">{t("loading")}</p>}
      {state === "ready" && <>
        <h3 className="mt-5 text-sm font-semibold text-ops-text">{t("formTitle")}</h3>
        <p className="mt-1 text-xs text-ops-muted">{t("formHint")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-sm">{t("version")}
            <select className="ops-input px-3 py-2" value={versionId} onChange={(event) => setVersionId(event.target.value)}>
              <option value="">{t("chooseVersion")}</option>
              {versions.map((item) => <option key={item.id} value={item.id}>
                {t("versionOption", { name: item.name, version: item.version, id: item.id })}
              </option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">{t("response")}
            <select className="ops-input px-3 py-2" value={response} onChange={(event) => setResponse(event.target.value as "scan" | "isolate")}>
              <option value="scan">{t("scan")}</option><option value="isolate">{t("isolate")}</option>
            </select>
          </label>
          <label className="flex items-start gap-2 self-end pb-2 text-xs text-ops-muted">
            <input type="checkbox" className="mt-0.5 size-4" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>{t("recommendationOnly")}</span>
          </label>
          <button type="button" disabled={pending || !confirmed} onClick={create}
            className="h-10 self-end rounded-md bg-ops-accent px-3 text-sm font-medium text-white disabled:opacity-50">{t("create")}</button>
        </div>
        {createError && <p role="alert" className="mt-2 text-sm text-ops-danger">{createError}</p>}
        {versions.length === 0 && <p className="mt-2 text-xs text-ops-muted">{t("noVersions")}</p>}
        {toggleError && <p role="alert" className="mt-2 text-sm text-ops-danger">{t("errorToggle")}</p>}
        <ul className="mt-5 divide-y divide-ops-border">
          {bindings.map((binding) => <li key={binding.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block text-ops-text">{binding.name} · v{binding.version}</span>
              <span className="block text-xs text-ops-muted">
                {t(binding.response === "isolate" ? "isolate" : "scan")} · {binding.state === "active" ? t("stateActive") : t("statePaused")}
                {" · "}{formatEpdrDateTime(binding.activated_at, timeZone, locale)}
                {!binding.current_connection && <> · {t("connectionChanged")}</>}
              </span>
            </span>
            <button type="button" disabled={pending || (!binding.current_connection && binding.state === "paused")}
              onClick={() => toggle(binding)} className="rounded border border-ops-border px-3 py-1.5 text-xs disabled:opacity-50">
              {binding.state === "active" ? t("pause") : t("resume")}
            </button>
          </li>)}
          {bindings.length === 0 && <li className="py-3 text-sm text-ops-muted">{t("bindingsEmpty")}</li>}
        </ul>
      </>}
    </div>

    {state === "ready" && <div className="ops-panel p-5">
      <h2 className="text-lg font-semibold text-ops-text">{t("recTitle")}</h2>
      <p className="mt-1 max-w-3xl text-sm text-ops-muted">{t("recDescription")}</p>
      {requestError && <p role="alert" className="mt-2 text-sm text-ops-danger">{requestError}</p>}
      <ul className="mt-3 divide-y divide-ops-border">
        {recommendations.map((item) => {
          const reasons = Array.isArray(item.reasons) ? item.reasons.filter((reason): reason is string => typeof reason === "string") : [];
          return <li key={item.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block text-ops-text">
                {t(item.status === "matched" ? "matched" : "blocked")} · {t(item.response === "isolate" ? "isolate" : "scan")}
                {" · "}{t("detection")} #{item.detection_id}
                {item.endpoint_id ? ` · ${t("endpoint")} #${item.endpoint_id}` : ` · ${t("unknownEndpoint")}`}
              </span>
              <span className="block text-xs text-ops-muted">
                {formatEpdrDateTime(item.created_at, timeZone, locale)}
                {reasons.length > 0 && ` · ${reasons.slice(0, 3).map((reason) => t.has(`reasons.${reason}`) ? t(`reasons.${reason}`) : t("reasonOther")).join(", ")}`}
              </span>
            </span>
            {item.request_id ? <Link href={`/${locale}/admin/epdr/approvals`} className="text-xs text-ops-accent underline">{t("viewRequest")}</Link>
              : item.status === "matched" && item.endpoint_id ? (requesting === item.id
                ? <span className="flex items-center gap-2">
                  <span className="text-xs text-ops-muted">{t("confirmHint")}</span>
                  <button type="button" disabled={pending} onClick={() => request(item)}
                    className="rounded bg-ops-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{t("confirmRequest")}</button>
                  <button type="button" disabled={pending} onClick={() => setRequesting(null)} className="text-xs underline">{t("cancel")}</button>
                </span>
                : <button type="button" disabled={pending} onClick={() => { setRequestError(null); setRequesting(item.id); }}
                  className="rounded border border-ops-border px-3 py-1.5 text-xs disabled:opacity-50">{t("request")}</button>)
              : <span className="text-xs text-ops-muted">{t("notRequestable")}</span>}
          </li>;
        })}
        {recError && <li role="alert" className="py-3 text-sm text-ops-danger">{t("error")}</li>}
        {!recError && recommendations.length === 0 && <li className="py-3 text-sm text-ops-muted">{t("recEmpty")}</li>}
      </ul>
    </div>}
  </section>;
}
