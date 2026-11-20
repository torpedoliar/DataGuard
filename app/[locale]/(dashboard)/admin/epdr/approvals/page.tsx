import EpdrNav from "@/components/admin/epdr/epdr-nav";
import LocalApprovals from "@/components/admin/epdr/local-approvals";
import ExecutionCenter from "@/components/admin/epdr/execution-center";
import ExecutionHealth from "@/components/admin/epdr/execution-health";
import PageHeader from "@/components/ui/page-header";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

export const metadata = { title: "Actions | DataGuard" };

/** Query values only preselect the request form; they never create or approve anything. */
function readPrefill(params: Record<string, string | string[] | undefined>) {
  const endpoint = typeof params.endpoint === "string" && /^[1-9]\d{0,9}$/.test(params.endpoint) ? Number(params.endpoint) : undefined;
  const action = typeof params.action === "string" && /^[a-z_]{1,40}$/.test(params.action) ? params.action : undefined;
  return { endpointId: endpoint !== undefined && Number.isSafeInteger(endpoint) ? endpoint : undefined, actionType: action };
}

export default async function EpdrApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) redirect("/select-site");
  const locale = await getLocale();
  const t = await getTranslations("Epdr");
  const prefill = readPrefill(await searchParams);
  return <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 lg:px-8">
    <PageHeader eyebrow={t("operationsV2.eyebrow")} title={t("operationsV2.approvalsTitle")} description={t("operationsV2.approvalsDescription")} />
    <EpdrNav isAdmin />
    <ExecutionHealth />
    <ExecutionCenter key={`execution-${guard.activeSiteId}`} locale={locale} prefill={prefill} />
    <details className="ops-panel p-5">
      <summary className="cursor-pointer text-sm font-semibold text-ops-text">{t("approvalsV2.title")}</summary>
      <div className="mt-4"><LocalApprovals key={`local-approvals-${guard.activeSiteId}`} locale={locale} /></div>
    </details>
  </main>;
}
