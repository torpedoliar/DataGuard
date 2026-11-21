import { getEpdrFleetOverview } from "@/actions/epdr-endpoints";
import EndpointFleet from "@/components/admin/epdr/endpoint-fleet";
import SyncRefresh from "@/components/admin/epdr/sync-refresh";
import EpdrNav from "@/components/admin/epdr/epdr-nav";
import ReadSyncPanel from "@/components/admin/epdr/read-sync-panel";
import NotificationInbox from "@/components/admin/epdr/notification-inbox";
import { ConnectionGate, FreshnessWarning, SecurityStatusPills } from "@/components/admin/epdr/security-chrome";
import { fleetQuerySchema } from "@/lib/epdr/fleet-query";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

export const metadata = {
  title: "Endpoint Security | DataGuard",
};

export default async function EpdrEndpointsPage({ searchParams }: { searchParams: Promise<{ filter?: string | string[]; query?: string | string[] }> }) {
  const session = await verifySession();
  if (!session) redirect("/login");
  if (!session.activeSiteId) redirect("/select-site");
  const { getLocale } = await import("next-intl/server");
  const locale = await getLocale();
  setRequestLocale(locale);
  const t = await getTranslations("Epdr");
  const params = await searchParams;
  // Only documented fleet filters are accepted; unknown values fall back to all.
  const parsedFilter = fleetQuerySchema.shape.filter.safeParse(
    typeof params.filter === "string" ? params.filter : undefined,
  );
  const initialFilter = parsedFilter.success ? parsedFilter.data : "all";
  const initialQuery = typeof params.query === "string" ? params.query.trim().slice(0, 80) : "";

  const data = await getEpdrFleetOverview();
  if ("message" in data) {
    return <main className="mx-auto max-w-3xl px-4 py-16 text-sm text-ops-muted">{data.message}</main>;
  }

  const hasData = data.summary.total > 0 && data.connection !== "not_configured";

  return (
    <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={data.siteName || t("endpoints.title")}
        description={t("endpoints.description")}
        actions={<SecurityStatusPills context={data} locale={locale} />}
      />

      <EpdrNav isAdmin={data.isAdmin} />
      {data.isAdmin && <details className="ops-panel p-5">
        <summary className="cursor-pointer text-sm font-medium text-ops-text">{t("overview.syncDetails")}</summary>
        <div className="mt-4"><ReadSyncPanel enabled={data.connection !== "not_configured" && data.connection !== "disabled"} /></div>
      </details>}
      <NotificationInbox locale={locale} />
      <ConnectionGate context={data} />
      <FreshnessWarning context={data} locale={locale} />
      {(data.connection === "syncing_first" || data.connection === "error" || data.connection === "stale") && (
        <SyncRefresh key={data.siteName} waiting={data.connection === "syncing_first"} />
      )}
      {hasData && <EndpointFleet posture={data.posture} endpoints={data.endpoints} summary={data.summary} isAdmin={data.isAdmin} locale={locale} initialFilter={initialFilter} initialQuery={initialQuery} />}
      {!hasData && data.connection === "live" && <p className="ops-panel p-6 text-sm text-ops-muted">{t("setup.emptyInventory")}</p>}
    </main>
  );
}
