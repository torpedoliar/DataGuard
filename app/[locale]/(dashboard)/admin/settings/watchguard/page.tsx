import { getWatchGuardSettings } from "@/actions/watchguard-settings";
import WatchGuardWizard from "@/components/admin/epdr/watchguard-wizard";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

export const metadata = {
  title: "WatchGuard connection | DataGuard",
};

export default async function WatchGuardSettingsPage() {
  const session = await verifySession();
  if (!session || session.role !== "superadmin") redirect("/admin/settings");
  const { getLocale } = await import("next-intl/server");
  setRequestLocale(await getLocale());
  const t = await getTranslations("Epdr");

  const data = await getWatchGuardSettings();
  if ("message" in data) {
    return <main className="mx-auto max-w-3xl px-4 py-16 text-sm text-ops-muted">{data.message}</main>;
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader eyebrow={`Settings / ${t("settings.title")}`} title={t("settings.title")} description={t("settings.description")} />
      <WatchGuardWizard initialData={data} />
    </main>
  );
}