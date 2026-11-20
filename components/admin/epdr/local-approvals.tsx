"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  decideEpdrLocalApproval, getEpdrLocalApprovals, type LocalApprovalPage, type LocalApprovalRow,
} from "@/actions/epdr-local-approvals";

export default function LocalApprovals({ locale }: { locale: string }) {
  const t = useTranslations("Epdr.approvalsV2");
  const [data, setData] = useState<LocalApprovalPage | null>(null);
  const [error, setError] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [pending, startTransition] = useTransition();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    getEpdrLocalApprovals().then((result) => {
      if (!active) return;
      if ("message" in result) { setError(true); setData(null); }
      else { setData(result); setError(false); }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [revision]);

  function decide(row: LocalApprovalRow, decision: "approve" | "reject") {
    startTransition(async () => {
      setError(false); setFeedback(null);
      try {
        const result = await decideEpdrLocalApproval({
          approvalId: row.id, decision, note: notes[row.id]?.trim() || undefined,
        });
        if ("message" in result) { setError(true); return; }
        setFeedback(t(result.status === "approved" ? "feedback.approved" : "feedback.rejected"));
        setRevision((value) => value + 1);
      } catch { setError(true); }
    });
  }

  // Rendered inside the "Local decision records" disclosure on the Actions page.
  return <section className="space-y-4">
    <p role="note" className="text-sm text-ops-muted">{t("hint")}</p>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={pending} onClick={() => setRevision((value) => value + 1)} className="text-sm text-ops-accent disabled:opacity-50">{t("retry")}</button>
      {data && <span className="text-sm text-ops-muted">{t("pendingCount", { count: data.pending })}</span>}
    </div>
    {feedback && <p role="status" className="text-sm text-ops-text">{feedback}</p>}
    {error && <p role="alert" className="text-sm text-ops-danger">{t("error")}</p>}
    {!data && !error && <p className="text-sm text-ops-muted">{t("loading")}</p>}
    {data && data.rows.length === 0 && <p className="text-sm text-ops-muted">{t("empty")}</p>}
    {data && data.rows.length > 0 && <ul className="divide-y divide-ops-border">
      {data.rows.map((row) => {
        const open = row.status === "pending";
        return <li key={row.id} className="space-y-2 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{t("row", { run: row.localRunId, detection: row.detectionId })}</span>
            <span className="text-ops-muted">{t(`intent.${row.actionIntent}`)}</span>
            <span className="text-ops-muted">{t(`status.${row.status}`)}</span>
            <span className="text-xs text-ops-subtle">{t("expires", { time: row.expiresAt })}</span>
            <Link href={`/${locale}/admin/epdr/playbooks?detection=${row.detectionId}`} className="text-ops-accent">{t("review")}</Link>
          </div>
          {row.status === "approved" && <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-ops-muted">{t("approvedNote")}</span>
            {/* Only preselects the execution form; the gated request/approve flow still applies. */}
            <Link href={`/${locale}/admin/epdr/approvals?endpoint=${row.endpointId}&action=${row.actionIntent}`} className="text-ops-accent underline">{t("createRequest")}</Link>
          </div>}
          {row.status === "rejected" && <p className="text-xs text-ops-muted">{t("rejectedNote")}</p>}
          {open && <div className="flex flex-wrap items-center gap-2">
            <input maxLength={500} value={notes[row.id] ?? ""} onChange={(event) => setNotes((old) => ({ ...old, [row.id]: event.target.value }))}
              placeholder={t("notePlaceholder")} className="ops-input min-w-56 flex-1 px-3 py-2 text-sm" />
            <button type="button" disabled={pending} onClick={() => decide(row, "approve")} className="rounded-md bg-ops-accent px-3 py-2 text-sm text-ops-bg disabled:opacity-50">{t("approve")}</button>
            <button type="button" disabled={pending} onClick={() => decide(row, "reject")} className="rounded-md border border-ops-border px-3 py-2 text-sm text-ops-text disabled:opacity-50">{t("reject")}</button>
          </div>}
        </li>;
      })}
    </ul>}
  </section>;
}
