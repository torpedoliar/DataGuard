import EpdrNav from "@/components/admin/epdr/epdr-nav";
import OperationsLedgerPanel from "@/components/admin/epdr/operations-ledger";
import PageHeader from "@/components/ui/page-header";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

export const metadata = { title: "Activity | DataGuard" };

export default async function EpdrActivityPage() {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) redirect("/select-site");
  const t = await getTranslations("Epdr.operationsV2");
  return <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 lg:px-8">
    <PageHeader eyebrow={t("eyebrow")} title={t("activityTitle")} description={t("activityDescription")} />
    <EpdrNav isAdmin />
    <OperationsLedgerPanel key={guard.activeSiteId} view="activity" />
  </main>;
}
