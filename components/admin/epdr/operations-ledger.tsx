"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getEpdrOperations, type OperationsLedger, type OperationsView } from "@/actions/epdr-operations";

export default function OperationsLedgerPanel({ view }: { view: OperationsView }) {
  const t = useTranslations("Epdr.operationsV2");
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<OperationsLedger | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    getEpdrOperations({ view, page }).then((result) => {
      if (!active) return;
      if ("message" in result) { setError(true); setData(null); }
      else { setData(result); setError(false); }
    }).catch(() => { if (active) { setError(true); setData(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [view, page, revision]);
  function changePage(next: number) { setLoading(true); setData(null); setPage(next); }
  return <section className="ops-panel space-y-4 p-5" aria-busy={loading}>
    <p role="note" className="text-sm text-ops-muted">{t("readOnly")} {t("activityHint")}</p>
    <button type="button" disabled={loading} className="text-sm text-ops-accent disabled:opacity-50" onClick={() => { setLoading(true); setData(null); setRevision((value) => value + 1); }}>{t("refresh")}</button>
    {loading && <p role="status">{t("loading")}</p>}
    {!loading && error && <p role="alert">{t("error")}</p>}
    {!loading && data && <>
      <p className="text-sm text-ops-muted">{t("summary", { total: data.total, page: data.page, limit: data.limit })}</p>
      {data.rows.length === 0 ? <p>{t("empty")}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr>{["time", "kind", "reference", "status", "intention", "actors"].map((key) => <th key={key} scope="col" className="p-2">{t(key)}</th>)}</tr></thead>
        <tbody>{data.rows.map((row) => <tr key={`${row.kind}-${row.id}`} className="border-t border-ops-border">
          <td className="p-2">{row.createdAt ? <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString(locale)}</time> : t("unknownTime")}</td>
          <td className="p-2">{t(`kinds.${row.kind}`)}</td><td className="p-2">#{row.id}</td>
          <td className="p-2">{t(`statuses.${row.status}`)}</td><td className="p-2">{row.action ? t(`actions.${row.action}`) : t("notApplicable")}</td>
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
