"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { getEpdrWriteSettings, saveEpdrWriteSettings, type WriteSettings, type WriteSettingsError } from "@/actions/epdr-write-settings";

function toggleAction(list: string[], action: string, checked: boolean): string[] {
  return checked ? [...list, action] : list.filter((value) => value !== action);
}

/** Site/deployment provider-write gates. Saving requires an explicit confirmation. */
export default function WriteEnablementPanel() {
  const t = useTranslations("Epdr.execution");
  const [settings, setSettings] = useState<WriteSettings | null>(null);
  const [error, setError] = useState<WriteSettingsError["code"] | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [revision, setRevision] = useState(0);

  const [enableSite, setEnableSite] = useState(false);
  const [enableGlobal, setEnableGlobal] = useState(false);
  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [globalActions, setGlobalActions] = useState<string[]>([]);
  const [siteCap, setSiteCap] = useState("");
  const [cooldownMinutes, setCooldownMinutes] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    getEpdrWriteSettings().then((result) => {
      if (!active) return;
      if ("code" in result) { setError(result.code); return; }
      setSettings(result);
      setEnableSite(result.siteEnabled);
      setEnableGlobal(result.globalEnabled);
      setSelectedActions(result.siteAllowedActions);
      setGlobalActions(result.globalAllowedActions);
      setSiteCap(result.siteMaxActionsPerHour === null ? "" : String(result.siteMaxActionsPerHour));
      setCooldownMinutes(String(result.executionCooldownMinutes));
    }).catch(() => { if (active) setError("service_unavailable"); });
    return () => { active = false; };
  }, [revision]);

  function save(current: WriteSettings) {
    startTransition(async () => {
      setError(null); setFeedback(null);
      const parsedCap = siteCap.trim() === "" ? null : Number(siteCap);
      const parsedCooldown = Number(cooldownMinutes);
      if ((siteCap.trim() !== "" && (!Number.isInteger(parsedCap) || (parsedCap ?? 0) < 1))
        || !Number.isInteger(parsedCooldown) || parsedCooldown < 0 || parsedCooldown > 1440) {
        setError("invalid_input");
        return;
      }
      try {
        const result = await saveEpdrWriteSettings({
          ...(current.isSuperadmin ? { globalEnabled: enableGlobal, globalAllowedActions: globalActions } : {}),
          siteEnabled: enableSite,
          siteAllowedActions: selectedActions,
          siteMaxActionsPerHour: parsedCap,
          executionCooldownMinutes: parsedCooldown,
          confirmWriteEnablement: true,
        });
        if (!mounted.current) return;
        if ("code" in result) { setError(result.code); return; }
        setFeedback(t("settings.saved"));
        setConfirmed(false);
        setRevision((value) => value + 1);
      } catch { if (mounted.current) setError("service_unavailable"); }
    });
  }

  const available = settings?.availableActions ?? [];
  return <div className="space-y-3 text-sm">
    <p className="text-xs text-ops-muted">{t("settings.hint")}</p>
    {error && <p role="alert" className="text-sm text-ops-danger">{t(`errors.${error}` as never)}</p>}
    {feedback && <p role="status" className="text-sm text-ops-text">{feedback}</p>}
    {!settings && !error && <p className="text-xs text-ops-muted">{t("loading")}</p>}
    {settings && <div className="space-y-3">
      {settings.isSuperadmin && <label className="flex items-start gap-2 text-xs text-ops-muted">
        <input type="checkbox" checked={enableGlobal} onChange={(event) => setEnableGlobal(event.target.checked)} className="mt-0.5" />
        {t("settings.globalToggle")}
      </label>}
      <label className="flex items-start gap-2 text-xs text-ops-muted">
        <input type="checkbox" checked={enableSite} onChange={(event) => setEnableSite(event.target.checked)} className="mt-0.5" />
        {t("settings.siteToggle")}
      </label>
      {settings.isSuperadmin && <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-ops-text">{t("settings.globalActions")}</legend>
        {available.map((action) => <label key={action} className="flex items-center gap-2 text-xs text-ops-muted">
          <input type="checkbox" checked={globalActions.includes(action)} onChange={(event) => {
            setGlobalActions((current) => toggleAction(current, action, event.target.checked));
          }} />
          {t(`actions.${action}` as never)}
        </label>)}
      </fieldset>}
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-ops-text">{t("settings.actions")}</legend>
        {available.map((action) => <label key={action} className="flex items-center gap-2 text-xs text-ops-muted">
          <input type="checkbox" checked={selectedActions.includes(action)} onChange={(event) => {
            setSelectedActions((current) => toggleAction(current, action, event.target.checked));
          }} />
          {t(`actions.${action}` as never)}
        </label>)}
      </fieldset>
      <label className="flex items-start gap-2 text-xs text-ops-muted">
        {t("settings.siteCap")}
        <input type="number" min={1} max={10000} value={siteCap} placeholder={t("settings.followGlobal")}
          onChange={(event) => setSiteCap(event.target.value)}
          className="w-24 rounded border border-ops-border bg-transparent px-2 py-1 text-xs text-ops-text" />
      </label>
      <label className="flex items-start gap-2 text-xs text-ops-muted">
        {t("settings.cooldown")}
        <input type="number" min={0} max={1440} value={cooldownMinutes}
          onChange={(event) => setCooldownMinutes(event.target.value)}
          className="w-24 rounded border border-ops-border bg-transparent px-2 py-1 text-xs text-ops-text" />
      </label>
      <label className="flex items-start gap-2 text-xs text-ops-muted">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5" />
        {t("settings.confirm")}
      </label>
      <button type="button" disabled={pending || !confirmed} onClick={() => save(settings)}
        className="rounded-md border border-ops-border px-3 py-2 text-sm text-ops-text disabled:opacity-50">{t("settings.save")}</button>
    </div>}
  </div>;
}
