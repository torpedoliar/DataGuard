"use client";

import { useEpdrTimeZone } from "./time-zone-provider";
import { formatEpdrDateTime } from "@/lib/epdr/time-zone";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getEpdrPlaybookHistory, recordEpdrPlaybookSimulation } from "@/actions/epdr-playbook-history";
import PlaybookVersionForm from "./playbook-version-form";

type History = Exclude<Awaited<ReturnType<typeof getEpdrPlaybookHistory>>, { message: string }>;

export default function PlaybookHistory() {
  const t = useTranslations("Epdr.historyV2");
  const { timeZone } = useEpdrTimeZone();
  const locale = useLocale();
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const [revision, setRevision] = useState(0);
  const [versionsPage, setVersionsPage] = useState(1);
  const [runsPage, setRunsPage] = useState(1);
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
  return <section className="ops-panel space-y-4 p-5">
    <h2 className="font-semibold text-ops-text">{t("title")}</h2>
    <p className="text-sm text-ops-muted">{t("hint")}</p>
    <PlaybookVersionForm onSaved={() => { setVersionsPage(1); setRevision((value) => value + 1); }} />
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
      <ul className="space-y-3">{history.runs.map((item) => <li key={item.id} className="text-sm text-ops-muted"><details><summary className="cursor-pointer">{t("run", { id: item.id, version: item.versionId })} · {formatEpdrDateTime(item.createdAt, timeZone, locale)}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-ops-surface-sunken p-3 text-xs">{JSON.stringify(item.evidence, null, 2)}</pre></details></li>)}</ul>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-ops-muted">{t("pageSummaryRuns", { page: runsCurrent, pages: runsPages, total: history.runsTotal ?? history.runs.length })}</span>
        <button type="button" className="text-ops-accent disabled:opacity-50" disabled={pending || runsCurrent <= 1} onClick={() => setRunsPage(runsCurrent - 1)}>{t("previous")}</button>
        <button type="button" className="text-ops-accent disabled:opacity-50" disabled={pending || runsCurrent >= runsPages} onClick={() => setRunsPage(runsCurrent + 1)}>{t("next")}</button>
      </div>
      {history.versions.length === 0 && <p className="text-sm text-ops-muted">{t("empty")}</p>}
    </>}
  </section>;
}
