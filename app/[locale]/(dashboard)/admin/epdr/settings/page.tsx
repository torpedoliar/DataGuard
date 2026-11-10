import { getEpdrSettings, saveEpdrSettings } from "@/actions/epdr-settings";
import ActionButton from "@/components/ui/action-button";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

function asForm(action: (formData: FormData) => Promise<unknown>): (formData: FormData) => Promise<void> {
  return action as unknown as (formData: FormData) => Promise<void>;
}

function check(name: string, value: boolean, label: string) {
  return (
    <label className="flex items-center gap-2 text-[13px] font-medium text-ops-muted">
      <input type="checkbox" name={name} defaultChecked={value} className="size-4" /> {label}
    </label>
  );
}

export default async function EpdrSettingsPage() {
  const session = await verifySession();
  if (!session) redirect("/login");
  if (!session.activeSiteId) redirect("/select-site");
  const { getLocale } = await import("next-intl/server");
  setRequestLocale(await getLocale());

  const data = await getEpdrSettings();
  if ("message" in data) {
    return <main className="mx-auto max-w-5xl px-4 py-10 text-ops-muted">{data.message}</main>;
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader eyebrow="Security / Settings" title="EPDR Settings" description="Aturan deteksi dan pengaman site." />
      <form action={asForm(saveEpdrSettings.bind(null, undefined))} className="ops-panel space-y-4 p-5">
        {check("ingestEnabled", data.ingestEnabled, "Aktifkan ingest deteksi")}
        {check("threatsyncEnabled", data.threatsyncEnabled, "Aktifkan insiden ThreatSync")}
        {check("siteKillSwitch", data.siteKillSwitch, "Kill switch site")}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            Event types (koma) <span className="text-xs">1 Malware, 2 PUP, 4 Exploit, 6 Virus, 18 IOA</span>
            <input name="eventTypes" defaultValue={data.eventTypes.join(",")} className="ops-input h-9 w-full px-3 font-mono text-sm" />
          </label>
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            Kategori ThreatSync (koma)
            <input name="threatsyncCategories" defaultValue={data.threatsyncCategories.join(",")} className="ops-input h-9 w-full px-3 font-mono text-sm" />
          </label>
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            Skor min ThreatSync (1–10)
            <input name="threatsyncMinScore" type="number" min={1} max={10} defaultValue={data.threatsyncMinScore} className="ops-input h-9 w-full px-3 text-sm" />
          </label>
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            Skor maks ThreatSync (1–10)
            <input name="threatsyncMaxScore" type="number" min={1} max={10} defaultValue={data.threatsyncMaxScore} className="ops-input h-9 w-full px-3 text-sm" />
          </label>
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            Jendela korelasi (menit)
            <input name="correlationWindowMinutes" type="number" min={5} defaultValue={data.correlationWindowMinutes} className="ops-input h-9 w-full px-3 text-sm" />
          </label>
          <label className="space-y-1 text-[13px] font-medium text-ops-muted">
            Jendela reopen (hari)
            <input name="reopenWindowDays" type="number" min={1} defaultValue={data.reopenWindowDays} className="ops-input h-9 w-full px-3 text-sm" />
          </label>
        </div>

        <div className="flex justify-end">
          <ActionButton type="submit">Simpan Deteksi</ActionButton>
        </div>
      </form>
    </main>
  );
}