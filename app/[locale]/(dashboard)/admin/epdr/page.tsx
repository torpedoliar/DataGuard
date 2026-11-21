import { getEpdrOverview } from "@/actions/epdr-overview";
import OperationsOverview from "@/components/admin/epdr/operations-overview";
import EpdrNav from "@/components/admin/epdr/epdr-nav";
import ReadSyncPanel from "@/components/admin/epdr/read-sync-panel";
import SyncRefresh from "@/components/admin/epdr/sync-refresh";
import { ConnectionGate, FreshnessWarning, SecurityStatusPills } from "@/components/admin/epdr/security-chrome";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";

export const metadata = { title: "Endpoint Security | DataGuard" };

export default async function EpdrOverviewPage() {
  const session = await verifySession();
  if (!session) redirect("/login");
  if (!session.activeSiteId) redirect("/select-site");
  const locale = await getLocale();
  setRequestLocale(locale);
  const t = await getTranslations("Epdr");
  const data = await getEpdrOverview();
  if ("message" in data) return <main className="mx-auto max-w-[1600px] px-4 py-16 text-sm text-ops-muted">{data.message}</main>;
  return <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
    <PageHeader eyebrow={t("eyebrow")} title={data.siteName || t("overview.title")}
      description={t("overview.description")} actions={<SecurityStatusPills context={data} locale={locale} />} />
    <EpdrNav isAdmin={data.isAdmin} />
    <ConnectionGate context={data} />
    <FreshnessWarning context={data} locale={locale} />
    {(data.connection === "syncing_first" || data.connection === "error" || data.connection === "stale") && <SyncRefresh key={data.siteName} waiting={data.connection === "syncing_first"} />}
    <OperationsOverview data={data} locale={locale} />
    {data.isAdmin && <details className="ops-panel p-5">
      <summary className="cursor-pointer text-sm font-medium text-ops-text">{t("overview.syncDetails")}</summary>
      <div className="mt-4"><ReadSyncPanel enabled={data.connection !== "not_configured" && data.connection !== "disabled"} /></div>
    </details>}
  </main>;
}
