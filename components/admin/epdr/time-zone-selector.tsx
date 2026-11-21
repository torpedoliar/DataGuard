"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { setEpdrTimeZone } from "@/actions/epdr-time-zone";
import { EPDR_TIME_ZONE_PRESETS } from "@/lib/epdr/time-zone";
import { useEpdrTimeZone } from "./time-zone-provider";

/** Controlled picker also preserves existing non-preset IANA values. */
export function TimeZoneSelect({ value, onChange, label, disabled = false, allowInherit = false, inheritLabel = "" }: {
  value: string | null; onChange: (zone: string | null) => void; label: string; disabled?: boolean;
  allowInherit?: boolean; inheritLabel?: string;
}) {
  const custom = value && !EPDR_TIME_ZONE_PRESETS.some((zone) => zone.value === value);
  return <label className="text-sm text-ops-text">{label}
    <select className="ml-2 rounded bg-ops-bg p-1" value={value ?? ""} disabled={disabled}
      onChange={(event) => onChange(event.target.value || null)}>
      {allowInherit && <option value="">{inheritLabel}</option>}
      {EPDR_TIME_ZONE_PRESETS.map((zone) => <option key={zone.value} value={zone.value}>{zone.label} ({zone.value})</option>)}
      {custom && <option value={value}>{value}</option>}
    </select>
  </label>;
}

export function TimeZoneSelector() {
  const t = useTranslations("Epdr.timeZone");
  const router = useRouter();
  const { personalTimeZone, setPersonalTimeZone } = useEpdrTimeZone();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  return <div className="space-y-2">
    <TimeZoneSelect value={personalTimeZone} label={t("label")} allowInherit inheritLabel={t("inherit")} disabled={pending}
      onChange={(zone) => startTransition(async () => {
        setStatus(null);
        try {
          const result = await setEpdrTimeZone(zone);
          if ("message" in result) setStatus("error");
          else { setPersonalTimeZone(result.timeZone); setStatus("saved"); router.refresh(); }
        } catch { setStatus("error"); }
      })} />
    {status && <p role={status === "error" ? "alert" : "status"}>{t(status)}</p>}
  </div>;
}
