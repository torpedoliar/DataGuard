import { getEpdrSettings, saveEpdrSettings } from "@/actions/epdr-settings";
import ActionButton from "@/components/ui/action-button";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { THREAT_CATEGORIES } from "@/lib/epdr/posture";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

export const metadata = {
  title: "EPDR settings | DataGuard",
};

/** Plain server form: checkbox groups submit arrays, which the action reads with getAll. */
function asFormAction(action: (formData: FormData) => Promise<unknown>): (formData: FormData) => Promise<void> {
  return action as unknown as (formData: FormData) => Promise<void>;
}

const EVENT_TYPES = [
  { value: 1, key: "malware" },
  { value: 2, key: "pup" },
  { value: 4, key: "exploit" },
  { value: 6, key: "virus" },
  { value: 18, key: "ioa" },
] as const;

function Checkbox({ name, value, defaultChecked, label, hint }: { name: string; value?: string; defaultChecked: boolean; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2.5 rounded-md border border-ops-border px-3 py-2">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="mt-0.5 size-4" />
      <span className="min-w-0">
        <span className="block text-[13px] text-ops-text">{label}</span>
        {hint && <span className="block text-[11.5px] text-ops-muted">{hint}</span>}
      </span>
    </label>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="ops-panel p-5">
      <legend className="px-1 text-[15px] font-semibold text-ops-text">{title}</legend>
      {hint && <p className="mt-1 text-[13px] text-ops-muted">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </fieldset>
  );
}

function NumberField({ name, label, hint, defaultValue, min, max }: { name: string; label: string; hint?: string; defaultValue: number; min?: number; max?: number }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-ops-text">{label}</span>
      {hint && <span className="mt-0.5 block text-[12px] text-ops-muted">{hint}</span>}
      <input name={name} type="number" min={min} max={max} defaultValue={defaultValue} className="ops-input mt-1.5 h-9 w-full px-3 text-sm" />
    </label>
  );
}

export default async function EpdrSettingsPage() {
  const session = await verifySession();
  if (!session) redirect("/login");
  if (!session.activeSiteId) redirect("/select-site");
  const { getLocale } = await import("next-intl/server");
  setRequestLocale(await getLocale());
  const t = await getTranslations("Epdr");

  const data = await getEpdrSettings();
  if ("message" in data) {
    return <main className="mx-auto max-w-3xl px-4 py-16 text-sm text-ops-muted">{data.message}</main>;
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader eyebrow={`Security / ${t("detection.title")}`} title={t("detection.title")} description={t("detection.description")} />

      <form action={asFormAction(saveEpdrSettings.bind(null, undefined))} className="space-y-6">
        <Section title={t("detection.signals")}>
          <label className="flex items-start gap-3 rounded-md border border-ops-border p-3.5">
            <input type="checkbox" name="ingestEnabled" defaultChecked={data.ingestEnabled} className="mt-0.5 size-4" />
            <span>
              <span className="block text-[13px] font-medium text-ops-text">{t("detection.events")}</span>
              <span className="block text-[12px] text-ops-muted">{t("detection.eventsHint")}</span>
            </span>
          </label>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {EVENT_TYPES.map((e) => (
              <Checkbox key={e.value} name="eventTypes" value={String(e.value)} defaultChecked={data.eventTypes.includes(e.value)} label={t(`category.${e.key}`)} />
            ))}
          </div>

          <label className="flex items-start gap-3 rounded-md border border-ops-border p-3.5">
            <input type="checkbox" name="threatsyncEnabled" defaultChecked={data.threatsyncEnabled} className="mt-0.5 size-4" />
            <span>
              <span className="block text-[13px] font-medium text-ops-text">{t("detection.threatsync")}</span>
            </span>
          </label>
          <div>
            <p className="text-[13px] font-medium text-ops-text">{t("detection.categories")}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {THREAT_CATEGORIES.map((c) => (
                <Checkbox key={c} name="threatsyncCategories" value={c} defaultChecked={data.threatsyncCategories.includes(c)} label={t(`category.${c}`)} />
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField name="threatsyncMinScore" label={t("detection.minScore")} defaultValue={data.threatsyncMinScore} min={1} max={10} />
            <NumberField name="threatsyncMaxScore" label={t("detection.maxScore")} hint={t("detection.scoreHint")} defaultValue={data.threatsyncMaxScore} min={1} max={10} />
            <NumberField name="correlationWindowMinutes" label={t("detection.correlation")} hint={t("detection.correlationHint")} defaultValue={data.correlationWindowMinutes} min={5} />
            <NumberField name="reopenWindowDays" label={t("detection.reopen")} hint={t("detection.reopenHint")} defaultValue={data.reopenWindowDays} min={1} />
            <label className="block">
              <span className="block text-[13px] font-medium text-ops-text">{t("detection.assignee")}</span>
              <input name="defaultAssigneeId" type="number" min={1} defaultValue={data.defaultAssigneeId ?? ""} className="ops-input mt-1.5 h-9 w-full px-3 text-sm" />
            </label>
          </div>
        </Section>

        <Section title={t("detection.health")} hint={t("detection.healthHint")}>
          <label className="flex items-start gap-3 rounded-md border border-ops-border p-3.5">
            <input type="checkbox" name="healthEnabled" defaultChecked={data.healthEnabled} className="mt-0.5 size-4" />
            <span className="block text-[13px] font-medium text-ops-text">{t("detection.healthEnabled")}</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField name="healthGraceMinutes" label={t("detection.healthGrace")} defaultValue={data.healthGraceMinutes} min={0} />
            <NumberField name="healthStageWaitHours" label={t("detection.healthStageWait")} defaultValue={data.healthStageWaitHours} min={1} />
            <NumberField name="healthStableMinutes" label={t("detection.healthStable")} defaultValue={data.healthStableMinutes} min={5} />
          </div>
          <label className="block">
            <span className="block text-[13px] font-medium text-ops-text">{t("detection.healthReboot")}</span>
            <select name="healthRebootMode" defaultValue={data.healthRebootMode} className="ops-input mt-1.5 h-9 w-full px-3 text-sm">
              {(["off", "approval", "automatic"] as const).map((m) => (
                <option key={m} value={m}>{t(`detection.rebootModes.${m}`)}</option>
              ))}
            </select>
          </label>
          <NumberField name="healthRebootCountdown" label={t("detection.healthRebootCountdown")} defaultValue={data.healthRebootCountdown} min={0} max={7} />
        </Section>

        <Section title={t("detection.breaker")} hint={t("detection.breakerHint")}>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField name="breakerMaxActions" label={t("detection.breakerMax")} defaultValue={data.breakerMaxActions} min={1} />
            <NumberField name="breakerWindowMinutes" label={t("detection.breakerWindow")} defaultValue={data.breakerWindowMinutes} min={1} />
            <NumberField name="breakerSameThreatEndpoints" label={t("detection.breakerSame")} defaultValue={data.breakerSameThreatEndpoints} min={1} />
          </div>
        </Section>

        <Section title={t("detection.killSwitch")} hint={t("detection.killSwitchHint")}>
          <label className="flex items-start gap-3 rounded-md border border-ops-danger/25 bg-ops-danger-soft/40 p-3.5">
            <input type="checkbox" name="siteKillSwitch" defaultChecked={data.siteKillSwitch} className="mt-0.5 size-4" />
            <span className="block text-[13px] font-medium text-ops-text">{t("detection.killSwitch")}</span>
          </label>
        </Section>

        <div className="flex justify-end">
          <ActionButton type="submit">{t("detection.save")}</ActionButton>
        </div>
      </form>
    </main>
  );
}
