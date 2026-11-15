import EpdrNav from "@/components/admin/epdr/epdr-nav";
import PlaybookCatalog from "@/components/admin/epdr/playbook-catalog";
import PlaybookHistory from "@/components/admin/epdr/playbook-history";
import LocalPlaybookRunner from "@/components/admin/epdr/local-playbook-runner";
import OperationalPlaybooks from "@/components/admin/epdr/operational-playbooks";
import PageHeader from "@/components/ui/page-header";
import ActionButton from "@/components/ui/action-button";
import { requireActiveSiteAction } from "@/lib/action-auth";
import { hasAdminAccess, requireSiteAccess } from "@/lib/site-access";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

export const metadata = { title: "Playbooks | DataGuard" };

export default async function EpdrPlaybooksPage() {
  const guard = await requireActiveSiteAction();
  if (!guard.ok) redirect("/select-site");
  if (!await requireSiteAccess(guard.activeSiteId)) redirect("/select-site");
  if (!await hasAdminAccess()) redirect("/admin/epdr");
  const locale = await getLocale();
  const t = await getTranslations("Epdr.playbooksV2");
  return <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 lg:px-8">
    <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} actions={<ActionButton variant="secondary" href={`/${locale}/admin/epdr`}>{t("back")}</ActionButton>} />
    <EpdrNav isAdmin />
    <PlaybookHistory key={`history-${guard.activeSiteId}`} />
    <LocalPlaybookRunner key={`local-${guard.activeSiteId}`} />
    <PlaybookCatalog key={guard.activeSiteId} />
    <OperationalPlaybooks key={`operational-${guard.activeSiteId}`} />
  </main>;
}
