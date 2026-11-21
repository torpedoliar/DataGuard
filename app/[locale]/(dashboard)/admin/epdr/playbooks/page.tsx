import EpdrNav from "@/components/admin/epdr/epdr-nav";
import PlaybookCatalog from "@/components/admin/epdr/playbook-catalog";
import PlaybookHistory from "@/components/admin/epdr/playbook-history";
import LocalPlaybookRunner from "@/components/admin/epdr/local-playbook-runner";
import OperationalPlaybooks from "@/components/admin/epdr/operational-playbooks";
import ResponseLibrary from "@/components/admin/epdr/response-library";
import PageHeader from "@/components/ui/page-header";
import ActionButton from "@/components/ui/action-button";
import { requireActiveSiteAction } from "@/lib/action-auth";
import { hasAdminAccess, requireSiteAccess } from "@/lib/site-access";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

export const metadata = { title: "Playbooks | DataGuard" };

export default async function EpdrPlaybooksPage({ searchParams }: { searchParams: Promise<{ detection?: string | string[] }> }) {
  const guard = await requireActiveSiteAction();
  if (!guard.ok) redirect("/select-site");
  if (!await requireSiteAccess(guard.activeSiteId)) redirect("/select-site");
  if (!await hasAdminAccess()) redirect("/admin/epdr");
  const locale = await getLocale();
  const t = await getTranslations("Epdr.playbooksV2");
  const params = await searchParams;
  const requested = typeof params.detection === "string" && /^[1-9]\d*$/.test(params.detection) ? Number(params.detection) : null;
  const initialDetectionId = requested !== null && Number.isSafeInteger(requested) ? requested : undefined;
  return <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 lg:px-8">
    <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} actions={<ActionButton variant="secondary" href={`/${locale}/admin/epdr/threats`}>{t("back")}</ActionButton>} />
    <EpdrNav isAdmin />
    <ResponseLibrary key={`responses-${guard.activeSiteId}`} />
    <LocalPlaybookRunner key={`local-${guard.activeSiteId}`} initialDetectionId={initialDetectionId} locale={locale} />
    <details className="ops-panel p-5">
      <summary className="cursor-pointer text-sm font-semibold text-ops-text">{t("advancedTitle")}</summary>
      <p className="mt-2 max-w-4xl text-sm text-ops-muted">{t("advancedDescription")}</p>
      <div className="mt-5 space-y-5">
        <details className="rounded-md border border-ops-border p-4">
          <summary className="cursor-pointer text-sm font-medium text-ops-text">{t("simulationTitle")}</summary>
          <p className="mt-2 text-sm text-ops-muted">{t("simulationHint")}</p>
          <div className="mt-4"><PlaybookHistory key={`history-${guard.activeSiteId}`} /></div>
        </details>
        <details className="rounded-md border border-ops-border p-4">
          <summary className="cursor-pointer text-sm font-medium text-ops-text">{t("catalogTitle")}</summary>
          <p className="mt-2 text-sm text-ops-muted">{t("catalogHint")}</p>
          <div className="mt-4"><PlaybookCatalog key={guard.activeSiteId} /></div>
        </details>
        <details className="rounded-md border border-ops-border p-4">
          <summary className="cursor-pointer text-sm font-medium text-ops-text">{t("operationalTitle")}</summary>
          <div className="mt-4"><OperationalPlaybooks key={`operational-${guard.activeSiteId}`} /></div>
        </details>
      </div>
    </details>
  </main>;
}
