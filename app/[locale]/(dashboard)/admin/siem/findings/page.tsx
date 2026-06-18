import { getSiemFindings, type SiemFindingListFilters } from "@/actions/siem-findings";
import SiemFindingTable from "@/components/admin/siem-finding-table";
import ActionButton from "@/components/ui/action-button";
import DataToolbar from "@/components/ui/data-toolbar";
import EmptyState from "@/components/ui/empty-state";
import PageHeader from "@/components/ui/page-header";
import { siemFindingStatuses } from "@/lib/siem/types";
import { verifySession } from "@/lib/session";
import { incidentSeverities } from "@/lib/incidents";
import { Filter, ShieldAlert, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(params: { [key: string]: string | string[] | undefined }): SiemFindingListFilters {
  const status = firstParam(params.status);
  const severity = firstParam(params.severity);
  return {
    status: status && siemFindingStatuses.includes(status as NonNullable<SiemFindingListFilters["status"]>) ? status as SiemFindingListFilters["status"] : undefined,
    severity: severity && incidentSeverities.includes(severity as NonNullable<SiemFindingListFilters["severity"]>) ? severity as SiemFindingListFilters["severity"] : undefined,
  };
}

export default async function SiemFindingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");
  if (!session.activeSiteId) redirect("/select-site");

  const params = await searchParams;
  const filters = parseFilters(params);
  const data = await getSiemFindings(filters);

  return (
    <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        eyebrow="SIEM / Findings"
        title="SIEM Findings"
        description="Rule-engine findings generated from parsed syslog events. Incident creation remains blocked until source maps to a device."
        actions={<ActionButton href="/admin/siem/events" variant="secondary">Event Explorer</ActionButton>}
      />

      <DataToolbar>
        <form className="flex w-full flex-wrap items-center gap-2" action="/admin/siem/findings">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-ops-muted">
            <Filter className="size-4" />
            Filters
          </div>
          <select name="status" defaultValue={filters.status ?? ""} className="ops-input h-9 min-w-40 px-3 text-sm">
            <option value="">All status</option>
            {siemFindingStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select name="severity" defaultValue={filters.severity ?? ""} className="ops-input h-9 min-w-40 px-3 text-sm">
            <option value="">All severity</option>
            {incidentSeverities.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
          </select>
          <ActionButton type="submit" size="sm" icon={<ShieldAlert className="size-4" />}>Filter</ActionButton>
          {(filters.status || filters.severity) && <ActionButton href="/admin/siem/findings" variant="ghost" size="sm">Reset</ActionButton>}
        </form>
      </DataToolbar>

      {"message" in data && data.message ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{data.message}</div>
      ) : data.findings.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="size-5" />}
          title="No SIEM findings"
          description="Rule worker findings appear here after parsed events match enabled rules. Adjust filters or check rule status."
          action={
            filters.status || filters.severity ? (
              <ActionButton href="/admin/siem/findings" variant="secondary" size="sm">
                Reset filters
              </ActionButton>
            ) : undefined
          }
        />
      ) : (
        <SiemFindingTable findings={data.findings} />
      )}
    </main>
  );
}
