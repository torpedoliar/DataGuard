"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { previewEpdrPlaybooks, type PlaybookPreview } from "@/actions/epdr-playbooks";
import { PLAYBOOK_CATEGORIES, PLAYBOOK_TEMPLATES, matchesPlaybookFilters, scorePolicyProposal, type PlaybookCategory, type PlaybookSource } from "@/lib/epdr/playbooks";
import ActionButton from "@/components/ui/action-button";

export default function PlaybookCatalog() {
  const t = useTranslations("Epdr.playbooksV2");
  const [category, setCategory] = useState("all");
  const [source, setSource] = useState("all");
  const [score, setScore] = useState<"all" | "missing" | "range">("all");
  const [preview, setPreview] = useState<PlaybookPreview | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const [minScore, setMinScore] = useState(1);
  const [maxScore, setMaxScore] = useState(10);
  const filters = { category, source, score, minScore, maxScore };
  const invalidRange = score === "range" && minScore > maxScore;
  const templates = PLAYBOOK_TEMPLATES.filter((template) => (category === "all" || template.categories?.includes(category as PlaybookCategory)) && (source === "all" || template.sources.includes(source as PlaybookSource)));
  const rows = preview?.rows.filter((row) => matchesPlaybookFilters(row, filters)) ?? [];
  function loadPreview() {
    setError(false);
    startTransition(async () => {
      try {
        const data = await previewEpdrPlaybooks();
        if ("message" in data) { setPreview(null); setError(true); }
        else setPreview(data);
      } catch { setPreview(null); setError(true); }
    });
  }
  const selectClass = "rounded-md border border-ops-border bg-ops-surface px-3 py-2 text-ops-text";
  return <div className="space-y-6">
    <section className="space-y-3 rounded-lg border border-ops-border bg-ops-surface p-4">
      <p className="font-medium text-ops-text">{t("locked")}</p>
      <p className="text-sm text-ops-muted">{t("safety")}</p>
      <p className="text-sm text-ops-muted">{t("severityNote")}</p>
      <p className="text-sm text-ops-muted">{t("coverage")}</p>
    </section>
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm text-ops-muted">{t("category")}<select className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="all">{t("all")}</option>{PLAYBOOK_CATEGORIES.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
      </select></label>
      <label className="grid gap-1 text-sm text-ops-muted">{t("source")}<select className={selectClass} value={source} onChange={(e) => setSource(e.target.value)}>
        <option value="all">{t("all")}</option>{["threatsync", "event_export", "health", "local"].map((s) => <option key={s} value={s}>{t(`sources.${s}`)}</option>)}
      </select></label>
      <label className="grid gap-1 text-sm text-ops-muted">{t("score")}<select className={selectClass} value={score} onChange={(e) => setScore(e.target.value as typeof score)}>
        <option value="all">{t("all")}</option><option value="range">{t("range")}</option><option value="missing">{t("missing")}</option>
      </select></label>
      {score === "range" && <>
        <label className="grid gap-1 text-sm text-ops-muted">{t("minScore")}<select className={selectClass} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>{Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>
        <label className="grid gap-1 text-sm text-ops-muted">{t("maxScore")}<select className={selectClass} value={maxScore} onChange={(e) => setMaxScore(Number(e.target.value))}>{Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>
      </>}
      <ActionButton isPending={pending} onClick={loadPreview}>{t("preview")}</ActionButton>
    </div>
    <p className="text-sm text-ops-muted">{t("filterNote")}</p>
    {invalidRange && <p role="alert" className="text-ops-danger">{t("invalidRange")}</p>}
    <section className="space-y-2 rounded-lg border border-ops-border p-4 text-sm text-ops-muted">
      <h2 className="font-semibold text-ops-text">{t("policyTitle")}</h2>
      <p>{t("policyNote")}</p>
      <ul>{["1-3", "4-6", "7-8", "9-10", "missing"].map((tier) => <li key={tier}>{t(`tiers.${tier}`)}</li>)}</ul>
    </section>
    {error && <p role="alert" className="text-ops-danger">{t("error")}</p>}
    <section aria-live="polite" className="space-y-2 text-sm text-ops-muted">
      {!preview ? <p>{t("notLoaded")}</p> : <>
        <h2 className="font-semibold text-ops-text">{t("sampleTitle", { site: preview.siteName, id: preview.siteId })}</h2>
        <p>{t("sample", { count: preview.rows.length, limit: preview.limit, since: preview.since, until: preview.sampledAt })}</p>
        {preview.detectionCompleteness === "unavailable" && <p className="text-ops-warning">{t("completenessUnavailable")}</p>}
        <p>{preview.truncated ? t("truncated") : t("bounded")}</p>
        {rows.length === 0 && <p>{t("empty")}</p>}
      </>}
    </section>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {templates.map((template) => <article key={template.id} className="space-y-3 rounded-lg border border-ops-border bg-ops-surface p-4">
        <h2 className="font-semibold text-ops-text">{t(`templates.${template.id}`)}</h2>
        <p className="text-sm text-ops-muted">{template.sources.map((s) => t(`sources.${s}`)).join(" / ")} · {template.categories?.map((c) => t(`categories.${c}`)).join(" / ") ?? t("notThreatCategory")}</p>
        <p className="text-sm text-ops-muted">{t("threshold", { score: template.minScore ?? t("notRequired") })}</p>
        <p className="text-sm text-ops-muted">{t("localSeverity", { severity: t(`severities.${template.localSeverity}`) })}</p>
        <ol className="list-inside list-decimal space-y-1 text-sm text-ops-muted">{template.steps.map((step) => <li key={step}>{t(`steps.${step}`)} — {t("inert")}</li>)}</ol>
        {!template.previewAvailable ? <p className="text-sm text-ops-muted">{t("healthUnavailable")}</p> : preview && <details className="text-sm text-ops-muted">
          <summary className="cursor-pointer text-ops-text">{t("results", { count: rows.length })}</summary>
          <ul className="mt-2 max-h-64 space-y-2 overflow-auto">{rows.map((row) => {
            const result = row.evaluations.find((e) => e.templateId === template.id)?.result;
            return result && <li key={row.id}>#{row.id} · {t(`statuses.${result.status}`)} · {t(`reasons.${result.reason}`)} · {t(`tiers.${scorePolicyProposal(row.score)}`)}</li>;
          })}</ul>
        </details>}
      </article>)}
    </div>
    {templates.length === 0 && <p className="text-ops-muted">{t("noTemplates")}</p>}
  </div>;
}
