"use client";

/**
 * Operator confirmation panel for ThreatSync provider targets.
 *
 * Shows unreviewed targets ingested by the provider_sync job, the endpoint the
 * provider's device id suggests, and the mislink report for historical
 * detections that kept an endpoint under the retired entity-as-device fallback.
 * Confirming never contacts the provider.
 */
import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  getEpdrProviderTargets,
  confirmEpdrProviderTarget,
  rejectEpdrProviderTarget,
  type ProviderTargetsData,
} from "@/actions/epdr-provider-targets";

type ProviderTargetErrorCode = "invalid_input" | "forbidden" | "not_found" | "state_conflict" | "endpoint_unavailable" | "service_unavailable";

export default function ProviderTargets({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations("Epdr.providerTargets");
  const [data, setData] = useState<ProviderTargetsData | null>(null);
  const [errorCode, setErrorCode] = useState<ProviderTargetErrorCode | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    getEpdrProviderTargets().then((result) => {
      if (!active) return;
      if ("code" in result) { setErrorCode(result.code); setData(null); }
      else {
        setData(result);
        setSelections(Object.fromEntries(result.candidates
          .filter((candidate) => candidate.suggestedEndpointId !== null)
          .map((candidate) => [candidate.targetId, String(candidate.suggestedEndpointId)])));
      }
    }).catch(() => { if (active) setErrorCode("service_unavailable"); });
    return () => { active = false; };
  }, [revision]);

  function run(operation: () => Promise<void>) {
    startTransition(async () => {
      setErrorCode(null);
      try { await operation(); } catch { setErrorCode("service_unavailable"); }
    });
  }

  if (!isAdmin) return null;

  return <section className="ops-panel flex flex-col gap-3 p-4">
    <h2 className="text-sm font-medium text-ops-text">{t("title")}</h2>
    <p className="text-xs text-ops-muted">{t("hint")}</p>
    {errorCode && <p role="alert" className="text-sm text-ops-danger">{t(`errors.${errorCode}` as never)}</p>}
    {feedback && <p role="status" className="text-sm text-ops-text">{feedback}</p>}

    {!data && !errorCode && <p className="text-xs text-ops-muted">{t("loading")}</p>}
    {data && data.candidates.length === 0 && <p className="text-xs text-ops-muted">{t("empty")}</p>}
    {data && data.candidates.map((candidate) => {
      const selected = selections[candidate.targetId] ?? "";
      const reason = reasons[candidate.targetId] ?? "";
      return <div key={candidate.targetId} className="rounded-md border border-ops-border p-3 text-xs">
        <p className="font-medium text-ops-text">
          {t("incidentLabel", { id: candidate.tsIncidentId })}
          <span className="ml-2 text-ops-muted">{t("entityLabel", { id: candidate.entityId })}</span>
          {candidate.providerStatus && <span className="ml-2 text-ops-muted">{t("statusLabel", { status: candidate.providerStatus })}</span>}
        </p>
        {candidate.suggestedHostName && <p className="mt-1 text-ops-muted">{t("suggested", { host: candidate.suggestedHostName })}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-ops-muted">
            {t("endpointLabel")}
            <select value={selected} onChange={(event) => setSelections((current) => ({ ...current, [candidate.targetId]: event.target.value }))}
              className="ml-2 rounded border border-ops-border bg-transparent px-2 py-1 text-xs text-ops-text">
              <option value="">{t("endpointPlaceholder")}</option>
              {data.endpoints.map((endpoint) => (
                <option key={endpoint.id} value={String(endpoint.id)}>
                  {endpoint.hostName ?? t("unknownHost", { id: endpoint.id })}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={pending || !selected} onClick={() => run(async () => {
            const result = await confirmEpdrProviderTarget({ targetId: candidate.targetId, endpointId: Number(selected) });
            if ("code" in result) { setErrorCode(result.code); return; }
            setFeedback(t("confirmed"));
            setRevision((value) => value + 1);
          })} className="rounded-md border border-ops-border px-3 py-1 text-ops-text disabled:opacity-50">{t("confirm")}</button>
          <input type="text" value={reason} placeholder={t("rejectReason")} aria-label={t("rejectReason")}
            onChange={(event) => setReasons((current) => ({ ...current, [candidate.targetId]: event.target.value }))}
            className="w-56 rounded border border-ops-border bg-transparent px-2 py-1 text-ops-text" />
          <button type="button" disabled={pending || reason.trim().length < 3} onClick={() => run(async () => {
            const result = await rejectEpdrProviderTarget({ targetId: candidate.targetId, reason: reason.trim() });
            if ("code" in result) { setErrorCode(result.code); return; }
            setFeedback(t("rejected"));
            setRevision((value) => value + 1);
          })} className="rounded-md border border-ops-border px-3 py-1 text-ops-text disabled:opacity-50">{t("reject")}</button>
        </div>
      </div>;
    })}

    {data && data.mislinked.length > 0 && <details className="rounded-md border border-ops-border p-3 text-xs">
      <summary className="cursor-pointer font-medium text-ops-text">{t("mislink.title", { count: data.mislinked.length })}</summary>
      <p className="mt-2 text-ops-muted">{t("mislink.hint")}</p>
      <table className="mt-2 w-full text-left">
        <thead><tr className="text-ops-muted">
          <th className="pr-2">{t("mislink.incident")}</th>
          <th className="pr-2">{t("mislink.entity")}</th>
          <th className="pr-2">{t("mislink.endpoint")}</th>
        </tr></thead>
        <tbody>
          {data.mislinked.map((row) => <tr key={row.detectionId}>
            <td className="pr-2 text-ops-text">{row.tsIncidentId ?? "—"}</td>
            <td className="pr-2 text-ops-text">{row.entityId}</td>
            <td className="pr-2 text-ops-text">{row.hostName ?? `#${row.endpointId}`}</td>
          </tr>)}
        </tbody>
      </table>
    </details>}
  </section>;
}
