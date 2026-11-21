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
  const ux = useTranslations("Epdr.settingsUx");
  const [fieldErrors, setFieldErrors] = useState<{ cap?: string; cooldown?: string }>({});
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
      const errors: { cap?: string; cooldown?: string } = {};
      if (siteCap.trim() !== "" && (!Number.isInteger(parsedCap) || (parsedCap ?? 0) < 1 || (parsedCap ?? 0) > Math.min(10000, current.globalMaxActionsPerHour))) errors.cap = ux("capError", { cap: current.globalMaxActionsPerHour });
      if (cooldownMinutes.trim() === "" || !Number.isInteger(parsedCooldown) || parsedCooldown < 0 || parsedCooldown > 1440) errors.cooldown = ux("cooldownError");
      setFieldErrors(errors);
      if (Object.keys(errors).length) return;
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

  const dirty = Boolean(settings && (enableSite !== settings.siteEnabled || enableGlobal !== settings.globalEnabled
    || [...selectedActions].sort().join() !== [...settings.siteAllowedActions].sort().join()
    || [...globalActions].sort().join() !== [...settings.globalAllowedActions].sort().join()
    || siteCap !== (settings.siteMaxActionsPerHour === null ? "" : String(settings.siteMaxActionsPerHour))
    || cooldownMinutes !== String(settings.executionCooldownMinutes)));
  const available = settings?.availableActions ?? [];
  return <div className="space-y-3 text-sm">
    <p className="text-xs text-ops-muted">{t("settings.hint")}</p>
    {error && <p role="alert" className="text-sm text-ops-danger">{t(`errors.${error}` as never)}</p>}
    {feedback && <p role="status" className="text-sm text-ops-text">{feedback}</p>}
    {!settings && !error && <p className="text-xs text-ops-muted">{t("loading")}</p>}
    {settings && <div className="space-y-3">
      {settings.isSuperadmin && <label className="flex items-start gap-2 text-xs text-ops-muted">
        <input type="checkbox" checked={enableGlobal} onChange={(event) => { setEnableGlobal(event.target.checked); setConfirmed(false); }} className="mt-0.5" />
        {t("settings.globalToggle")}
      </label>}
      <label className="flex items-start gap-2 text-xs text-ops-muted">
        <input type="checkbox" checked={enableSite} onChange={(event) => { setEnableSite(event.target.checked); setConfirmed(false); }} className="mt-0.5" />
        {t("settings.siteToggle")}
      </label>
      <div className="overflow-x-auto rounded-md border border-ops-border">
        <table className="w-full text-left text-xs">
          <caption className="p-3 text-left text-ops-muted">{ux("matrixHint")}</caption>
          <thead className="bg-ops-surface-raised"><tr>{["action", "global", "site", "executable"].map((key) => <th key={key} scope="col" className="p-3">{ux(`matrix.${key}` as never)}</th>)}</tr></thead>
          <tbody>{available.map((action) => {
            const executable = enableGlobal && enableSite && !settings.globalKillSwitch && !settings.siteKillSwitch && globalActions.includes(action) && selectedActions.includes(action);
            return <tr key={action} className="border-t border-ops-border">
              <th scope="row" className="p-3 font-medium">{t(`actions.${action}` as never)}</th>
              <td className="p-3">{settings.isSuperadmin ? <input type="checkbox" aria-label={`${t("settings.globalActions")}: ${t(`actions.${action}` as never)}`} checked={globalActions.includes(action)} onChange={(event) => { setGlobalActions((current) => toggleAction(current, action, event.target.checked)); setConfirmed(false); }} /> : ux(globalActions.includes(action) ? "allowed" : "blocked")}</td>
              <td className="p-3"><input type="checkbox" aria-label={`${t("settings.actions")}: ${t(`actions.${action}` as never)}`} checked={selectedActions.includes(action)} onChange={(event) => { setSelectedActions((current) => toggleAction(current, action, event.target.checked)); setConfirmed(false); }} /></td>
              <td className={`p-3 ${executable ? "text-ops-accent" : "text-ops-muted"}`}>{ux(executable ? "eligible" : "blocked")}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <p className="text-xs text-ops-muted">{ux("globalCap", { cap: settings.globalMaxActionsPerHour })}</p>
      <label className="flex items-start gap-2 text-xs text-ops-muted">
        {t("settings.siteCap")}
        <input type="number" min={1} max={Math.min(10000, settings.globalMaxActionsPerHour)} aria-invalid={Boolean(fieldErrors.cap)} aria-describedby={fieldErrors.cap ? "epdr-cap-error" : undefined} value={siteCap} placeholder={t("settings.followGlobal")}
          onChange={(event) => { setSiteCap(event.target.value); setConfirmed(false); setFieldErrors((current) => ({ ...current, cap: undefined })); }}
          className="w-24 rounded border border-ops-border bg-transparent px-2 py-1 text-xs text-ops-text" />
      </label>
      {fieldErrors.cap && <p id="epdr-cap-error" role="alert" className="text-xs text-ops-danger">{fieldErrors.cap}</p>}
      <label className="flex items-start gap-2 text-xs text-ops-muted">
        {t("settings.cooldown")}
        <input type="number" min={0} max={1440} aria-invalid={Boolean(fieldErrors.cooldown)} aria-describedby={fieldErrors.cooldown ? "epdr-cooldown-error" : undefined} value={cooldownMinutes}
          onChange={(event) => { setCooldownMinutes(event.target.value); setConfirmed(false); setFieldErrors((current) => ({ ...current, cooldown: undefined })); }}
          className="w-24 rounded border border-ops-border bg-transparent px-2 py-1 text-xs text-ops-text" />
      </label>
      {fieldErrors.cooldown && <p id="epdr-cooldown-error" role="alert" className="text-xs text-ops-danger">{fieldErrors.cooldown}</p>}
      <p role="status" className="text-xs text-ops-muted">{ux(dirty ? "unsaved" : "savedState")}</p>
      <label className="flex items-start gap-2 text-xs text-ops-muted">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5" />
        {t("settings.confirm")}
      </label>
      <button type="button" disabled={pending || !confirmed || !dirty} onClick={() => save(settings)}
        className="rounded-md border border-ops-border px-3 py-2 text-sm text-ops-text disabled:opacity-50">{t("settings.save")}</button>
    </div>}
  </div>;
}
