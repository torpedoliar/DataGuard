import { getSettings } from "@/actions/settings";
import { getSiemAiSettings, getSiemIngestSettings } from "@/actions/siem-settings";
import { getNetworkDocSettings } from "@/actions/network-doc-settings";
import { getNcmSettings } from "@/actions/ncm-settings";
import { getWatchGuardSettings } from "@/actions/watchguard-settings";
import SettingsForm from "@/components/admin/settings-form";
import SiemAiSettingsForm from "@/components/admin/siem-ai-settings-form";
import SiemIngestSettingsForm from "@/components/admin/siem-ingest-settings-form";
import NcmSettingsForm from "@/components/admin/ncm-settings-form";
import WatchGuardSettingsCard from "@/components/admin/epdr/watchguard-settings-card";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import PageHeader from "@/components/ui/page-header";

export const metadata = {
    title: "Global Settings | DataGuard Admin",
    description: "Manage application branding and Telegram alerts.",
};

export default async function SettingsPage() {
    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        redirect("/admin");
    }

    // Activate the next-intl request locale so getTranslations below resolves
    // messages for the current /<locale>/admin/settings URL.
    const { getLocale } = await import("next-intl/server");
    const locale = await getLocale();
    setRequestLocale(locale);

    const t = await getTranslations("Settings");

    const [settings, siemAiSettings, siemIngestSettings, networkDocSettings, ncmSettings, watchGuardSettings] = await Promise.all([
        getSettings(),
        getSiemAiSettings(),
        getSiemIngestSettings(),
        getNetworkDocSettings(),
        getNcmSettings(),
        getWatchGuardSettings(),
    ]);

    return (
        <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
            <PageHeader eyebrow="Admin / Settings" title={t("title")} description={t("description")} />
            <SettingsForm initialData={settings} />
            {!("message" in siemIngestSettings) && <SiemIngestSettingsForm initialData={siemIngestSettings} />}
            {!("message" in siemAiSettings) && <SiemAiSettingsForm initialData={siemAiSettings} />}
            {!("message" in ncmSettings) && <NcmSettingsForm initialData={ncmSettings} networkDoc={"message" in networkDocSettings ? undefined : networkDocSettings} />}
            {!("message" in watchGuardSettings) && <WatchGuardSettingsCard data={watchGuardSettings} />}
        </main>
    );
}
