"use client";

/**
 * Shared playbook version authoring form (T02).
 *
 * Template/name/filter/save — the exact fields `saveEpdrPlaybookVersion`
 * accepts. Rendered by the history panel and inline by the local review
 * runner (so "no versions" points at authoring right where the operator is,
 * not at a different panel). `onSaved` receives the new version so the caller
 * can select it after refreshing its choices.
 */
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { saveEpdrPlaybookVersion } from "@/actions/epdr-playbook-history";
import { PLAYBOOK_TEMPLATES } from "@/lib/epdr/playbooks";

export default function PlaybookVersionForm({ onSaved }: { onSaved?: (saved: { id: number; version: number }) => void }) {
  const t = useTranslations("Epdr.historyV2");
  const catalog = useTranslations("Epdr.playbooksV2");
  const [templateId, setTemplateId] = useState("ioa");
  const [name, setName] = useState("");
  const [minimum, setMinimum] = useState(7);
  const [maximum, setMaximum] = useState(10);
  const [score, setScore] = useState<"all" | "missing" | "range">("all");
  const [category, setCategory] = useState("all");
  const [source, setSource] = useState("all");
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputClass = "ops-input px-3 py-2";
  return <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
    event.preventDefault();
    startTransition(async () => {
      setError(false);
      try {
        const result = await saveEpdrPlaybookVersion({
          templateId, name, mode: "simulate",
          filters: { category, source, score, minScore: minimum, maxScore: maximum },
        });
        if ("message" in result) setError(true);
        else onSaved?.(result);
      } catch { setError(true); }
    });
  }}>
    <label className="grid gap-1 text-sm" aria-label={t("template")}>{t("template")}
      <select className={inputClass} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
        {PLAYBOOK_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{catalog(`templates.${template.id}`)}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-sm" aria-label={t("name")}>{t("name")}
      <input required maxLength={120} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
    </label>
    <label className="grid gap-1 text-sm" aria-label={catalog("category")}>{catalog("category")}
      <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="all">{catalog("all")}</option>
        {["ioa", "malware", "pup", "virus", "exploit"].map((value) => <option key={value} value={value}>{catalog(`categories.${value}`)}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-sm" aria-label={catalog("source")}>{catalog("source")}
      <select className={inputClass} value={source} onChange={(e) => setSource(e.target.value)}>
        <option value="all">{catalog("all")}</option>
        {["threatsync", "event_export", "health", "local"].map((value) => <option key={value} value={value}>{catalog(`sources.${value}`)}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-sm" aria-label={catalog("score")}>{catalog("score")}
      <select className={inputClass} value={score} onChange={(e) => setScore(e.target.value as typeof score)}>
        <option value="all">{catalog("all")}</option>
        <option value="missing">{catalog("missing")}</option>
        <option value="range">{catalog("range")}</option>
      </select>
    </label>
    {score === "range" && <>
      <label className="grid gap-1 text-sm" aria-label={catalog("minScore")}>{catalog("minScore")}
        <input className={inputClass} type="number" min={1} max={10} value={minimum} onChange={(e) => setMinimum(Number(e.target.value))} />
      </label>
      <label className="grid gap-1 text-sm" aria-label={catalog("maxScore")}>{catalog("maxScore")}
        <input className={inputClass} type="number" min={1} max={10} value={maximum} onChange={(e) => setMaximum(Number(e.target.value))} />
      </label>
    </>}
    <button disabled={pending || minimum > maximum || !name.trim()} className="rounded-md bg-ops-accent px-3 py-2 text-sm text-ops-bg disabled:opacity-50">{t("save")}</button>
    {error ? <span role="alert" className="text-xs text-ops-danger">{t("error")}</span>
      : minimum > maximum ? <span aria-live="polite" className="text-xs text-ops-danger">{catalog("invalidRange")}</span> : null}
  </form>;
}
