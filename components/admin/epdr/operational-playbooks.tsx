"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { previewEpdrOperationalPlaybooks, type OperationalPreview } from "@/actions/epdr-operational-playbooks";

export default function OperationalPlaybooks() {
  const t = useTranslations("Epdr.operationalV2");
  const [preview, setPreview] = useState<OperationalPreview | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  function load() {
    setPreview(null); setError(false);
    startTransition(async () => {
      try {
        const result = await previewEpdrOperationalPlaybooks();
        if ("message" in result) { setError(true); return; }
        setPreview(result);
      } catch { setError(true); }
    });
  }
  return <section className="space-y-3">
    <h2>{t("title")}</h2>
    <p>{t("observationOnly")}</p>
    <button type="button" disabled={pending} onClick={load}>{t(pending ? "loading" : "load")}</button>
    {error && <p role="alert">{t("error")}</p>}
    {preview && <>
      <p>{t("sample", { limit: preview.limit, sampledAt: preview.sampledAt })}</p>
      {preview.truncated && <p>{t("truncated")}</p>}
      {!preview.rows.length && <p>{t("empty")}</p>}
      <table><thead><tr><th>{t("source")}</th><th>{t("recordId")}</th><th>{t("template")}</th><th>{t("result")}</th></tr></thead>
        <tbody>{preview.rows.flatMap((row) => row.evaluations.map(({ templateId, result }) => <tr key={`${row.source}-${row.id}-${templateId}`}>
          <td>{t(`sources.${row.source}`)}</td><td>{row.id}</td><td>{t(`templates.${templateId}`)}</td><td>{t(`statuses.${result.status}`)} — {t(`reasons.${result.reason}`)}</td>
        </tr>))}</tbody>
      </table>
    </>}
  </section>;
}
