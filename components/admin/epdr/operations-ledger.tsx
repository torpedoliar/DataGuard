"use client";

import Link from "next/link";
import { useEpdrTimeZone } from "./time-zone-provider";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getEpdrOperations, type OperationsLedger, type OperationsView } from "@/actions/epdr-operations";

export default function OperationsLedgerPanel({ view }: { view: OperationsView }) {
  const t = useTranslations("Epdr.operationsV2");
  const locale = useLocale();
  const h = useTranslations("Epdr.historyUx");
  const { timeZone } = useEpdrTimeZone();
  const [filters, setFilters] = useState({ kind: "", status: "", from: "", to: "" });
  const [applied, setApplied] = useState({ kind: "", status: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<OperationsLedger | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    getEpdrOperations({ view, page, ...Object.fromEntries(Object.entries(applied).filter(([, value]) => value !== "")) }).then((result) => {
      if (!active) return;
      if ("message" in result) { setError(true); }
      else { setData(result); setError(false); }
    }).catch(() => { if (active) { setError(true); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [view, page, revision, applied]);
  function changePage(next: number) { setLoading(true); setData(null); setPage(next); }
  return <section className="ops-panel space-y-4 p-5" aria-busy={loading}>
    <h2 className="text-lg font-semibold text-ops-text">{h("title")}</h2>
    <p className="text-sm text-ops-muted">{h("outcomeNotice")}</p>
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(event) => { event.preventDefault(); setLoading(true); setError(false); setData(null); setPage(1); setApplied({ ...filters }); }}>
      <label className="grid gap-1 text-sm">{t("kind")}<select className="ops-input px-3 py-2" value={filters.kind} onChange={(event) => setFilters({ ...filters, kind: event.target.value })}>
        <option value="">{h("allKinds")}</option>{["action", "evaluation", "handoff", "simulation", "readSync", "localRun", "notification", "approval"].map((kind) => <option key={kind} value={kind}>{t(`kinds.${kind}`)}</option>)}
      </select></label>
      <label className="grid gap-1 text-sm">{t("status")}<select className="ops-input px-3 py-2" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
        <option value="">{h("allStatuses")}</option>{["pending", "running", "succeeded", "failed", "cancelled", "blocked", "simulated", "recorded", "partial", "expired", "unknown"].map((status) => <option key={status} value={status}>{status === "succeeded" ? h("completedRecord") : t(`statuses.${status}`)}</option>)}
      </select></label>
      <label className="grid gap-1 text-sm">{h("from")}<input type="date" min="0001-01-01" max={filters.to || "9998-12-31"} className="ops-input px-3 py-2" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
      <label className="grid gap-1 text-sm">{h("to")}<input type="date" min={filters.from || "0001-01-01"} max="9998-12-31" className="ops-input px-3 py-2" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
      <button type="submit" disabled={loading} className="self-end rounded border border-ops-border px-3 py-2 text-sm disabled:opacity-50">{h("apply")}</button>
    </form>
    <p className="text-xs text-ops-muted">{h("utcBounds")} {h("displayZone", { zone: timeZone })}</p>
    <p role="note" className="text-sm text-ops-muted">{t("readOnly")} {t("activityHint")}</p>
    <button type="button" disabled={loading} className="text-sm text-ops-accent disabled:opacity-50" onClick={() => { setLoading(true); setError(false); setRevision((value) => value + 1); }}>{t("refresh")}</button>
    {loading && <p role="status">{t("loading")}</p>}
    {!loading && error && <p role="alert">{t("error")} {data && h("stale")}</p>}
    {!loading && data && <>
      <p className="text-sm text-ops-muted">{t("summary", { total: data.total, page: data.page, limit: data.limit })}</p>
      {data.rows.length === 0 ? <p>{t("empty")}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr>{["time", "kind", "reference", "status", "intention", "actors"].map((key) => <th key={key} scope="col" className="p-2">{t(key)}</th>)}</tr></thead>
        <tbody>{data.rows.map((row) => <tr key={`${row.kind}-${row.id}`} className="border-t border-ops-border">
          <td className="p-2">{row.createdAt ? <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString(locale, { timeZone })}</time> : t("unknownTime")}</td>
          <td className="p-2">{t(`kinds.${row.kind}`)}</td><td className="p-2"><span>#{row.id}</span>
            {row.context?.incidentId && <Link className="block text-ops-accent underline" href={`/${locale}/admin/incidents/${row.context.incidentId}`}>{h("incident", { id: row.context.incidentId })}</Link>}
            {row.context?.detectionId && <Link className="block text-ops-accent underline" href={`/${locale}/admin/epdr/playbooks?detection=${row.context.detectionId}`}>{h("localContext", { id: row.context.detectionId })}</Link>}
            {row.context?.versionId && <span className="block text-xs text-ops-muted">{h("version", { id: row.context.versionId })}</span>}
            {row.context?.actionId && <span className="block text-xs text-ops-muted">{h("actionReference", { id: row.context.actionId })}</span>}
            {row.context?.localRunId && <span className="block text-xs text-ops-muted">{h("localReference", { id: row.context.localRunId })}</span>}
          </td>
          <td className="p-2">{row.status === "succeeded" ? h("completedRecord") : t(`statuses.${row.status}`)}</td><td className="p-2">{row.action ? t(`actions.${row.action}`) : t("notApplicable")}</td>
          <td className="p-2">
            {row.requestedBy && <p>{t("requestedBy", { name: row.requestedBy })}</p>}
            {row.approvedBy && <p>{t("approvedBy", { name: row.approvedBy })}</p>}
            {row.selfApproved && <span className="rounded border border-ops-border px-2 py-1 text-xs">{t("selfApproved")}</span>}
            {!row.requestedBy && !row.approvedBy && t("notApplicable")}
          </td>
        </tr>)}</tbody>
      </table></div>}
      <div className="flex items-center gap-4">
        <button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)} className="text-sm text-ops-accent disabled:opacity-50">{t("previous")}</button>
        <button type="button" disabled={page * data.limit >= data.total || page >= 10000} onClick={() => changePage(page + 1)} className="text-sm text-ops-accent disabled:opacity-50">{t("next")}</button>
      </div>
    </>}
  </section>;
}
