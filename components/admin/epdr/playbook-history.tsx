"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { getEpdrPlaybookHistory, recordEpdrPlaybookSimulation, saveEpdrPlaybookVersion } from "@/actions/epdr-playbook-history";
import { PLAYBOOK_TEMPLATES } from "@/lib/epdr/playbooks";

type History = Exclude<Awaited<ReturnType<typeof getEpdrPlaybookHistory>>, { message: string }>;

export default function PlaybookHistory() {
  const t = useTranslations("Epdr.historyV2");
  const catalog = useTranslations("Epdr.playbooksV2");
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const [revision, setRevision] = useState(0);
  const [versionsPage, setVersionsPage] = useState(1);
  const [runsPage, setRunsPage] = useState(1);
  const [templateId, setTemplateId] = useState("ioa");
  const [name, setName] = useState("");
  const [minimum, setMinimum] = useState(7);
  const [maximum, setMaximum] = useState(10);
  const [score, setScore] = useState<"all" | "missing" | "range">("all");
  const [category, setCategory] = useState("all");
  const [source, setSource] = useState("all");
  useEffect(() => {
    let active = true;
    getEpdrPlaybookHistory({ versionsPage, runsPage }).then((data) => {
      if (!active) return;
      if ("message" in data) { setError(true); setHistory(null); }
      else {
        setHistory(data); setError(false);
        // Server clamps pages; mirror the accepted page so paging cannot loop.
        const acceptedVersionsPage = data.versionsPage ?? 1;
        const acceptedRunsPage = data.runsPage ?? 1;
        if (acceptedVersionsPage !== versionsPage) setVersionsPage(acceptedVersionsPage);
        if (acceptedRunsPage !== runsPage) setRunsPage(acceptedRunsPage);
      }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [revision, versionsPage, runsPage]);
  function run(operation: () => Promise<{ message: string } | { id: number }>, resetPage?: () => void) {
    startTransition(async () => {
      setError(false);
      try {
        const result = await operation();
        if ("message" in result) setError(true);
        else { resetPage?.(); setRevision((value) => value + 1); }
      } catch { setError(true); }
    });
  }
  const versionsPages = history ? Math.max(1, history.versionsPages ?? Math.ceil(history.versionsTotal / Math.max(1, history.limit))) : 1;
  const runsPages = history ? Math.max(1, history.runsPages ?? Math.ceil(history.runsTotal / Math.max(1, history.limit))) : 1;
  const versionsCurrent = history?.versionsPage ?? versionsPage;
  const runsCurrent = history?.runsPage ?? runsPage;
  const inputClass = "ops-input px-3 py-2";
  return <section className="ops-panel space-y-4 p-5">
    <h2 className="font-semibold text-ops-text">{t("title")}</h2>
    <p className="text-sm text-ops-muted">{t("hint")}</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
      event.preventDefault();
      run(() => saveEpdrPlaybookVersion({ templateId, name, mode: "simulate", filters: { category, source, score, minScore: minimum, maxScore: maximum } }), () => setVersionsPage(1));
    }}>
      <label className="grid gap-1 text-sm">{t("template")}<select className={inputClass} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>{PLAYBOOK_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{catalog(`templates.${template.id}`)}</option>)}</select></label>
      <label className="grid gap-1 text-sm">{t("name")}<input required maxLength={120} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="grid gap-1 text-sm">{catalog("category")}<select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">{catalog("all")}</option>{["ioa", "malware", "pup", "virus", "exploit"].map((value) => <option key={value} value={value}>{catalog(`categories.${value}`)}</option>)}</select></label>
      <label className="grid gap-1 text-sm">{catalog("source")}<select className={inputClass} value={source} onChange={(e) => setSource(e.target.value)}><option value="all">{catalog("all")}</option>{["threatsync", "event_export", "health", "local"].map((value) => <option key={value} value={value}>{catalog(`sources.${value}`)}</option>)}</select></label>
      <label className="grid gap-1 text-sm">{catalog("score")}<select className={inputClass} value={score} onChange={(e) => setScore(e.target.value as typeof score)}><option value="all">{catalog("all")}</option><option value="missing">{catalog("missing")}</option><option value="range">{catalog("range")}</option></select></label>
      {score === "range" && <>
        <label className="grid gap-1 text-sm">{catalog("minScore")}<input className={inputClass} type="number" min={1} max={10} value={minimum} onChange={(e) => setMinimum(Number(e.target.value))} /></label>
        <label className="grid gap-1 text-sm">{catalog("maxScore")}<input className={inputClass} type="number" min={1} max={10} value={maximum} onChange={(e) => setMaximum(Number(e.target.value))} /></label>
      </>}
      <button disabled={pending || minimum > maximum || !name.trim()} className="rounded-md bg-ops-accent px-3 py-2 text-sm text-ops-bg disabled:opacity-50">{t("save")}</button>
    </form>
    {error && <p role="alert" className="text-sm text-ops-danger">{t("error")}</p>}
    <button type="button" disabled={pending} onClick={() => setRevision((value) => value + 1)} className="text-sm text-ops-accent">{t("refresh")}</button>
    {!history ? <p className="text-sm text-ops-muted">{t("unavailable")}</p> : <>
      <p className="text-sm text-ops-muted">{t("bounded", { count: history.limit })}</p>
      <ul className="divide-y divide-ops-border">{history.versions.map((version) => <li key={version.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
        <span>{version.name} · v{version.version} · #{version.id}</span>
        <button type="button" disabled={pending} onClick={() => run(() => recordEpdrPlaybookSimulation(version.id), () => setRunsPage(1))} className="text-ops-accent disabled:opacity-50">{t("record")}</button>
      </li>)}</ul>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-ops-muted">{t("pageSummary", { page: versionsCurrent, pages: versionsPages, total: history.versionsTotal ?? history.versions.length })}</span>
        <button type="button" className="text-ops-accent disabled:opacity-50" disabled={pending || versionsCurrent <= 1} onClick={() => setVersionsPage(versionsCurrent - 1)}>{t("previous")}</button>
        <button type="button" className="text-ops-accent disabled:opacity-50" disabled={pending || versionsCurrent >= versionsPages} onClick={() => setVersionsPage(versionsCurrent + 1)}>{t("next")}</button>
      </div>
      <h3 className="font-medium">{t("runs")}</h3>
      <ul className="space-y-3">{history.runs.map((item) => <li key={item.id} className="text-sm text-ops-muted"><details><summary className="cursor-pointer">{t("run", { id: item.id, version: item.versionId })} · {item.createdAt}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-ops-surface-sunken p-3 text-xs">{JSON.stringify(item.evidence, null, 2)}</pre></details></li>)}</ul>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-ops-muted">{t("pageSummaryRuns", { page: runsCurrent, pages: runsPages, total: history.runsTotal ?? history.runs.length })}</span>
        <button type="button" className="text-ops-accent disabled:opacity-50" disabled={pending || runsCurrent <= 1} onClick={() => setRunsPage(runsCurrent - 1)}>{t("previous")}</button>
        <button type="button" className="text-ops-accent disabled:opacity-50" disabled={pending || runsCurrent >= runsPages} onClick={() => setRunsPage(runsCurrent + 1)}>{t("next")}</button>
      </div>
      {history.versions.length === 0 && <p className="text-sm text-ops-muted">{t("empty")}</p>}
    </>}
  </section>;
}
