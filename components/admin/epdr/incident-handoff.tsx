"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createEpdrIncidentHandoff, getEpdrHandoffOptions } from "@/actions/epdr-incident-handoff";

type Options = Exclude<Awaited<ReturnType<typeof getEpdrHandoffOptions>>, { message: string }>;

export default function IncidentHandoff({ detectionId, locale }: { detectionId: number; locale: string }) {
  const t = useTranslations("Epdr.handoffV2");
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [options, setOptions] = useState<Options | null>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [picGroupId, setPicGroupId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState(false);
  const [incidentId, setIncidentId] = useState<number | null>(null);
  // The action distinguishes a newly created incident from an existing linked
  // one; the operator must know which happened.
  const [lastWasExisting, setLastWasExisting] = useState(false);
  const [pending, startTransition] = useTransition();
  function open() {
    setExpanded(true);
    startTransition(async () => {
      try {
        const data = await getEpdrHandoffOptions();
        if ("message" in data) setError(true);
        else { setOptions(data); setError(false); }
      } catch { setError(true); }
    });
  }
  if (!expanded) return <button type="button" onClick={open} className="text-xs font-medium text-ops-accent">{t("open")}</button>;
  return <div className="w-full space-y-3 rounded-md border border-ops-border bg-ops-surface-sunken p-3">
    <p className="text-sm text-ops-text">{t("hint")}</p>
    {incidentId !== null && <p role="status" className="text-sm text-ops-text">
      {lastWasExisting ? t("existingResult", { id: incidentId }) : t("result", { id: incidentId })}
    </p>}
    {incidentId !== null && <Link href={`/${locale}/admin/incidents/${incidentId}`} className="text-sm text-ops-accent">{t("openIncident", { id: incidentId })}</Link>}
    {incidentId === null && options && <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
      event.preventDefault();
      startTransition(async () => {
        setError(false);
        try {
          const result = await createEpdrIncidentHandoff({ detectionId, assigneeId: assigneeId ? Number(assigneeId) : null, picGroupId: picGroupId ? Number(picGroupId) : null, note });
          if ("message" in result) setError(true);
          else { setIncidentId(result.incidentId); setLastWasExisting(result.existing); router.refresh(); }
        } catch { setError(true); }
      });
    }}>
      <label className="grid gap-1 text-xs">{t("assignee")}<select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="ops-input px-2 py-2"><option value="">{t("none")}</option>{options.assignees.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
      <label className="grid gap-1 text-xs">{t("pic")}<select value={picGroupId} onChange={(e) => setPicGroupId(e.target.value)} className="ops-input px-2 py-2"><option value="">{t("none")}</option>{options.picGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label className="grid gap-1 text-xs">{t("note")}<input required maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className="ops-input px-2 py-2" /></label>
      <button disabled={pending || !note.trim()} className="rounded-md bg-ops-accent px-3 py-2 text-xs text-ops-bg disabled:opacity-50">{t("confirm")}</button>
    </form>}
    {error && <p role="alert" className="text-xs text-ops-danger">{t("error")}</p>}
    {!options && !pending && incidentId === null && <button type="button" onClick={open} className="text-xs text-ops-accent">{t("retry")}</button>}
    {incidentId === null && <button type="button" disabled={pending} onClick={() => setExpanded(false)} className="text-xs text-ops-muted">{t("cancel")}</button>}
  </div>;
}
