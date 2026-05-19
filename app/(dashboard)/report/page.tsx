import { getAnalyticsStats, getReportData } from "@/actions/report";
import ExportButton from "@/components/report/export-button";
import PhotoModalTrigger from "@/components/report/photo-modal-trigger";
import ReportFilters from "@/components/report/report-filters";
import DataToolbar from "@/components/ui/data-toolbar";
import {
  DataTable,
  DataTableBody,
  DataTableEmpty,
  DataTableFrame,
  DataTableHead,
} from "@/components/ui/data-table";
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";
import StatsCard from "@/components/ui/stats-card";
import StatusBadge from "@/components/ui/status-badge";
import { incidentStatuses, type IncidentStatus } from "@/lib/incidents";
import { verifySession } from "@/lib/session";
import { getChecklistStatusTone, getIncidentStatusTone } from "@/lib/ui/status";
import { AlertTriangle, CheckCircle2, Clock3, ClipboardList, Pencil, TrendingUp } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await verifySession();
  if (!session) redirect("/login");

  const params = await searchParams;

  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const formatDate = (date: Date) => date.toISOString().split("T")[0];

  const startDate = (params.startDate as string) || formatDate(firstDay);
  const endDate = (params.endDate as string) || formatDate(today);
  const incidentStatusParam = params.incidentStatus as string | undefined;
  const incidentStatus = incidentStatusParam && incidentStatuses.includes(incidentStatusParam as IncidentStatus)
    ? incidentStatusParam as IncidentStatus
    : undefined;

  const page = Number(params.page as string) || 1;
  const pageSize = 20;

  let stats;
  try {
    stats = await getAnalyticsStats();
  } catch (error) {
    console.error("Failed to fetch analytics stats:", error);
    stats = null;
  }

  let reportResult;
  try {
    reportResult = await getReportData(startDate, endDate, page, pageSize, incidentStatus);
  } catch (error) {
    console.error("Failed to fetch report data:", error);
    reportResult = { data: [], total: 0, totalPages: 0, currentPage: page };
  }

  const { data: reportData, total, totalPages, currentPage } = reportResult;

  if (!stats) {
    stats = {
      kpis: {
        complianceRate: "0",
        totalAudits: 0,
        openIssues: 0,
        avgResolution: "N/A",
      },
      monthlyTrends: [],
      failureByCategory: [],
    };
  }

  const maxTrendValue = Math.max(...stats.monthlyTrends.map((trend) => trend.healthy + trend.faulty), 1);

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        eyebrow="Resolve / Reports"
        title="Reports"
        description="Compliance history, incident-linked checks, and exportable audit evidence."
      />

      <DataToolbar>
        <div className="flex w-full flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <ReportFilters />
          <ExportButton />
        </div>
      </DataToolbar>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard
          label="Compliance Rate"
          value={`${stats.kpis.complianceRate}%`}
          tone="success"
          icon={<CheckCircle2 className="size-5" />}
        />
        <StatsCard
          label="Total Audits"
          value={stats.kpis.totalAudits}
          tone="info"
          icon={<ClipboardList className="size-5" />}
        />
        <StatsCard
          label="Open Issues"
          value={stats.kpis.openIssues}
          tone="orange"
          icon={<AlertTriangle className="size-5" />}
        />
        <StatsCard
          label="Avg Resolution"
          value={stats.kpis.avgResolution}
          tone="accent"
          icon={<Clock3 className="size-5" />}
        />
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="ops-panel flex min-h-[360px] flex-col p-5 xl:col-span-2">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-ops-text">Health Trends</h2>
              <p className="text-sm text-ops-muted">Healthy checks vs reported faults over the last 12 months.</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-emerald-400" />
                <span className="text-ops-muted">Healthy</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-orange-400" />
                <span className="text-ops-muted">Faulty</span>
              </div>
            </div>
          </div>

          <div className="flex min-h-[260px] flex-1 items-end justify-between gap-1.5 px-2">
            {stats.monthlyTrends.length === 0 ? (
              <p className="w-full self-center text-center text-sm text-ops-muted">No trend data available.</p>
            ) : (
              stats.monthlyTrends.map((trend) => {
                const healthyPct = (trend.healthy / maxTrendValue) * 100;
                const faultyPct = (trend.faulty / maxTrendValue) * 100;

                return (
                  <div key={trend.month} className="flex w-full flex-col items-center gap-2">
                    <div className="flex h-[220px] w-full items-end justify-center gap-0.5">
                      <div
                        className="max-w-[18px] flex-1 rounded-t bg-emerald-400 transition-colors hover:bg-emerald-300"
                        style={{ height: `${healthyPct}%` }}
                        title={`Healthy: ${trend.healthy}`}
                      />
                      <div
                        className="max-w-[18px] flex-1 rounded-t bg-orange-400 transition-colors hover:bg-orange-300"
                        style={{ height: `${Math.max(faultyPct, 2)}%` }}
                        title={`Faulty: ${trend.faulty}`}
                      />
                    </div>
                    <span className="w-full truncate text-center text-[10px] text-ops-muted">{trend.month}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="ops-panel flex flex-col p-5">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-ops-text">Failure Frequency</h2>
              <p className="text-sm text-ops-muted">Incidents grouped by category.</p>
            </div>
            <TrendingUp className="size-5 text-ops-muted" />
          </div>
          <div className="flex flex-1 flex-col justify-center gap-5">
            {stats.failureByCategory.length === 0 ? (
              <p className="text-center text-sm text-ops-muted">No failures recorded.</p>
            ) : (
              stats.failureByCategory.map((category) => (
                <div key={category.category}>
                  <div className="mb-2 flex justify-between gap-3 text-sm">
                    <span className="font-semibold text-ops-text">{category.categoryName}</span>
                    <span className="text-xs text-ops-muted">{category.count} incidents</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-ops-bg">
                    <div
                      className="h-full rounded-full bg-ops-orange"
                      style={{ width: `${Math.min(category.count * 10, 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-ops-text">Detailed Compliance Log</h2>
          <p className="text-sm text-ops-muted">Checklist records with linked incidents, notes, and evidence.</p>
        </div>

        <DataTableFrame>
          <DataTable className="whitespace-nowrap">
            <DataTableHead>
              <tr>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">Date & Time</th>
                <th className="px-4 py-3.5">Device Name</th>
                <th className="px-4 py-3.5">Category</th>
                <th className="px-4 py-3.5">Checked By</th>
                <th className="px-4 py-3.5">Notes</th>
                <th className="px-4 py-3.5">Incident</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {reportData.length === 0 ? (
                <DataTableEmpty
                  colSpan={8}
                  title="No report data found"
                  description="Adjust the date range or incident filter to broaden the report."
                />
              ) : (
                reportData.map((item) => (
                  <tr key={item.id} className="transition-colors hover:bg-ops-surface">
                    <td className="px-4 py-3">
                      <StatusBadge tone={getChecklistStatusTone(item.status)} dot>
                        {item.status === "OK" ? "Healthy" : item.status}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-ops-muted">{item.date} {item.time}</td>
                    <td className="px-4 py-3 font-semibold text-ops-text">{item.device}</td>
                    <td className="px-4 py-3 text-ops-muted">{item.category}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex size-6 items-center justify-center rounded-full bg-blue-400/12 text-[10px] font-bold text-blue-200">
                          {item.checker?.substring(0, 2).toUpperCase()}
                        </div>
                        <span className="text-slate-300">{item.checker}</span>
                      </div>
                    </td>
                    <td className="max-w-[240px] px-4 py-3 text-ops-muted">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{item.remarks || "-"}</span>
                        {item.photo && <PhotoModalTrigger photoPath={item.photo} deviceName={item.device} />}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {item.incidentId ? (
                        <Link href={`/admin/incidents/${item.incidentId}`} className="inline-flex">
                          <StatusBadge tone={getIncidentStatusTone(item.incidentStatus)} className="hover:border-red-300/40">
                            #{item.incidentId} {item.incidentStatus}
                          </StatusBadge>
                        </Link>
                      ) : (
                        <span className="text-ops-muted">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/report/edit/${item.entryId}`}
                        className="inline-flex size-8 items-center justify-center rounded-md border border-ops-border bg-ops-surface text-[#b7f5e4] transition-colors hover:border-ops-accent/50"
                        title="Edit report entry"
                      >
                        <Pencil className="size-4" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </DataTableBody>
          </DataTable>
        </DataTableFrame>

        {totalPages > 1 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={total}
            pageSize={pageSize}
          />
        )}
      </section>
    </main>
  );
}
