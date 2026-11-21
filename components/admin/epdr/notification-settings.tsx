"use client";

import { TimeZoneSelect } from "./time-zone-selector";
import { useEpdrTimeZone } from "./time-zone-provider";
import { formatEpdrDateTime } from "@/lib/epdr/time-zone";
import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { getEpdrNotificationPolicy, setEpdrNotificationPolicy } from "@/actions/epdr-notifications";
import type { LocalNotificationPolicy } from "@/lib/epdr/local-notification-outbox";

export default function NotificationSettings() {
  const t = useTranslations("Epdr.notifyV2");
  const tz = useTranslations("Epdr.timeZone");
  const { timeZone: displayZone } = useEpdrTimeZone();
  const [timeZone, setTimeZone] = useState("UTC");
  const [policy, setPolicy] = useState<LocalNotificationPolicy | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [notifyHeld, setNotifyHeld] = useState(false);
  const [escalateOverdue, setEscalateOverdue] = useState(false);
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestHour, setDigestHour] = useState(8);
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [quietStart, setQuietStart] = useState(22);
  const [quietEnd, setQuietEnd] = useState(7);
  const quietInvalid = quietEnabled && quietStart === quietEnd;
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    getEpdrNotificationPolicy().then((data) => {
      if (!active) return;
      if ("message" in data) { setError(true); return; }
      setPolicy(data);
      setTimeZone(data.timeZone ?? "UTC");
      setEnabled(data.enabled);
      setNotifyHeld(data.notifyHeld);
      setEscalateOverdue(data.escalateOverdueToAdmins);
      setDigestEnabled(data.digestEnabled);
      setDigestHour(data.digestHourUtc ?? 8);
      setQuietEnabled(data.quietStart !== null && data.quietEnd !== null);
      setQuietStart(data.quietStart ?? 22);
      setQuietEnd(data.quietEnd ?? 7);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);

  return <section className="ops-panel space-y-3 p-5">
    <h2 className="font-semibold text-ops-text">{t("title")}</h2>
    <p className="text-sm text-ops-muted">{t("hint")}</p>
    <TimeZoneSelect value={timeZone} onChange={(zone) => setTimeZone(zone ?? "UTC")} label={tz("schedulingLabel")} disabled={!policy || pending} />
    <label className="flex items-start gap-2 text-sm text-ops-text">
      <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-0.5" />
      {t("enabled")}
    </label>
    <label className="flex items-start gap-2 text-sm text-ops-text">
      <input type="checkbox" checked={notifyHeld} disabled={!enabled} onChange={(e) => setNotifyHeld(e.target.checked)} className="mt-0.5" />
      {t("notifyHeld")}
    </label>
    <label className="flex items-start gap-2 text-sm text-ops-text">
      <input type="checkbox" checked={escalateOverdue} disabled={!enabled} onChange={(e) => setEscalateOverdue(e.target.checked)} className="mt-0.5" />
      {t("escalateOverdue")}
    </label>
    <p className="text-xs text-ops-muted">{t("escalateHint")}</p>
    <label className="flex items-start gap-2 text-sm text-ops-text">
      <input type="checkbox" checked={digestEnabled} disabled={!enabled} onChange={(e) => setDigestEnabled(e.target.checked)} className="mt-0.5" />
      {t("digestEnabled")}
    </label>
    <p className="text-xs text-ops-muted">{t("digestHint")}</p>
    <label>{t("digestHour")}
      <select value={digestHour} disabled={!digestEnabled || pending} onChange={(e) => setDigestHour(Number(e.target.value))} className="ml-2 rounded bg-ops-bg p-1">
        {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00 {timeZone}</option>)}
      </select>
    </label>
    <label className="flex items-start gap-2 text-sm text-ops-text">
      <input type="checkbox" checked={quietEnabled} disabled={!policy || pending} onChange={(e) => setQuietEnabled(e.target.checked)} className="mt-0.5" />
      {t("quietEnabled")}
    </label>
    <p className="text-xs text-ops-muted">{t("quietHint")}</p>
    <div className="flex flex-wrap gap-3 text-sm text-ops-text">
      <label>{t("quietStart")}
        <select value={quietStart} disabled={!quietEnabled || pending} onChange={(e) => setQuietStart(Number(e.target.value))} className="ml-2 rounded bg-ops-bg p-1">
          {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00 {timeZone}</option>)}
        </select>
      </label>
      <label>{t("quietEnd")}
        <select value={quietEnd} disabled={!quietEnabled || pending} onChange={(e) => setQuietEnd(Number(e.target.value))} className="ml-2 rounded bg-ops-bg p-1">
          {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00 {timeZone}</option>)}
        </select>
      </label>
    </div>
    {quietInvalid && <p role="alert" className="text-sm text-ops-danger">{t("quietInvalid")}</p>}
    <p className="text-xs text-ops-muted">{t("scope")}</p>
    {policy?.updatedAt && <p className="text-xs text-ops-subtle">{t("updated", { time: formatEpdrDateTime(policy.updatedAt, displayZone) })}</p>}
    <button type="button" disabled={pending || !policy || quietInvalid} onClick={() => startTransition(async () => {
      setError(false); setSaved(false);
      try {
        const result = await setEpdrNotificationPolicy({ enabled, notifyHeld, timeZone,
          escalateOverdueToAdmins: escalateOverdue,
          digestEnabled, digestHourUtc: digestEnabled ? digestHour : null,
          quietStart: quietEnabled ? quietStart : null, quietEnd: quietEnabled ? quietEnd : null });
        if ("message" in result) setError(true);
        else { setPolicy(result); setSaved(true); }
      } catch { setError(true); }
    })} className="rounded-md bg-ops-accent px-3 py-2 text-sm text-ops-bg disabled:opacity-50">{t("save")}</button>
    {saved && <p role="status" className="text-sm text-ops-muted">{t("saved")}</p>}
    {error && <p role="alert" className="text-sm text-ops-danger">{t("error")}</p>}
  </section>;
}
