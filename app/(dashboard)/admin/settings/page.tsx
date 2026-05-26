import { getSettings } from "@/actions/settings";
import { getSiemAiSettings, getSiemIngestSettings } from "@/actions/siem-settings";
import SettingsForm from "@/components/admin/settings-form";
import SiemAiSettingsForm from "@/components/admin/siem-ai-settings-form";
import SiemIngestSettingsForm from "@/components/admin/siem-ingest-settings-form";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";

export const metadata = {
    title: "Global Settings | DataGuard Admin",
    description: "Manage application branding and Telegram alerts.",
};

export default async function SettingsPage() {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) {
        redirect("/admin");
    }

    const [settings, siemAiSettings, siemIngestSettings] = await Promise.all([
        getSettings(),
        getSiemAiSettings(),
        getSiemIngestSettings(),
    ]);

    return (
        <div className="py-8 px-6 max-w-[1600px] mx-auto min-h-[calc(100vh-56px)]">
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                    <div className="size-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400">
                        <span className="material-symbols-outlined text-[20px]">settings</span>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white tracking-tight">Pengaturan Aplikasi</h1>
                        <p className="text-sm text-slate-400 mt-1">
                            Sesuaikan branding aplikasi dan template notifikasi Telegram.
                        </p>
                    </div>
                </div>
            </div>

            <SettingsForm initialData={settings} />
            {!("message" in siemIngestSettings) && <SiemIngestSettingsForm initialData={siemIngestSettings} />}
            {!("message" in siemAiSettings) && <SiemAiSettingsForm initialData={siemAiSettings} />}
        </div>
    );
}
