
import { getAnalyticsStats, getReportData } from "@/actions/report";
import ExportButton from "@/components/report/export-button";
import ReportFilters from "@/components/report/report-filters";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Pagination from "@/components/ui/pagination";
import Link from "next/link";

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
    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    const startDate = (params.startDate as string) || formatDate(firstDay);
    const endDate = (params.endDate as string) || formatDate(today);

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
        reportResult = await getReportData(startDate, endDate, page, pageSize);
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
                avgResolution: "N/A"
            },
            monthlyTrends: [],
            failureByCategory: []
        };
    }

    return (
        <main className="flex-1 flex flex-col p-5 max-w-[1600px] mx-auto w-full gap-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-white tracking-tight font-display">Reports</h2>
                    <p className="text-slate-400 text-sm mt-0.5">Historical trends and compliance data</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <ReportFilters />
                    <ExportButton />
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="glow-card p-5">
                    <div className="flex justify-between items-start mb-3">
                        <p className="text-slate-400 text-sm font-medium">Compliance Rate</p>
                        <div className="size-9 rounded-xl bg-green-500/10 flex items-center justify-center text-green-400">
                            <span className="material-symbols-outlined text-[20px]">check_circle</span>
                        </div>
                    </div>
                    <h3 className="text-4xl font-bold text-white">{stats.kpis.complianceRate}%</h3>
                </div>
                <div className="glow-card p-5">
                    <div className="flex justify-between items-start mb-3">
                        <p className="text-slate-400 text-sm font-medium">Total Audits</p>
                        <div className="size-9 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400">
                            <span className="material-symbols-outlined text-[20px]">assignment</span>
                        </div>
                    </div>
                    <h3 className="text-4xl font-bold text-white">{stats.kpis.totalAudits}</h3>
                </div>
                <div className="glow-card p-5">
                    <div className="flex justify-between items-start mb-3">
                        <p className="text-slate-400 text-sm font-medium">Open Issues</p>
                        <div className="size-9 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-400">
                            <span className="material-symbols-outlined text-[20px]">warning</span>
                        </div>
                    </div>
                    <h3 className="text-4xl font-bold text-white">{stats.kpis.openIssues}</h3>
                </div>
                <div className="glow-card p-5">
                    <div className="flex justify-between items-start mb-3">
                        <p className="text-slate-400 text-sm font-medium">Avg Resolution</p>
                        <div className="size-9 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400">
                            <span className="material-symbols-outlined text-[20px]">timer</span>
                        </div>
                    </div>
                    <h3 className="text-4xl font-bold text-white">{stats.kpis.avgResolution}</h3>
                </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Bar Chart */}
                <div className="xl:col-span-2 glow-card p-6 flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h3 className="text-lg font-bold text-white">Health Trends (Last 12 Months)</h3>
                            <p className="text-xs text-slate-500 mt-0.5">Healthy checks vs reported faults</p>
                        </div>
                        <div className="flex items-center gap-4 text-xs">
                            <div className="flex items-center gap-1.5">
                                <span className="size-2.5 rounded-full bg-blue-500" />
                                <span className="text-slate-400">Healthy</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="size-2.5 rounded-full bg-orange-500" />
                                <span className="text-slate-400">Faulty</span>
                            </div>
                        </div>
                    </div>
                    <div className="relative flex-1 min-h-[280px] w-full flex items-end justify-between gap-1.5 px-2">
                        {stats.monthlyTrends.length === 0 ? (
                            <p className="w-full text-center text-slate-500 self-center">No trend data available.</p>
                        ) : (
                            stats.monthlyTrends.map((trend, i) => {
                                const maxVal = Math.max(...stats.monthlyTrends.map(t => t.healthy + t.faulty), 1);
                                const hPct = (trend.healthy / maxVal) * 100;
                                const fPct = (trend.faulty / maxVal) * 100;
                                return (
                                    <div key={i} className="flex flex-col items-center gap-1.5 group w-full">
                                        <div className="w-full flex gap-0.5 h-[220px] items-end justify-center">
                                            <div
                                                className="flex-1 max-w-[18px] bg-blue-500 rounded-t transition-all duration-500 hover:bg-blue-400"
                                                style={{ height: `${hPct}%` }}
                                                title={`Healthy: ${trend.healthy}`}
                                            />
                                            <div
                                                className="flex-1 max-w-[18px] bg-orange-500 rounded-t transition-all duration-500 hover:bg-orange-400"
                                                style={{ height: `${Math.max(fPct, 2)}%` }}
                                                title={`Faulty: ${trend.faulty}`}
                                            />
                                        </div>
                                        <span className="text-[10px] text-slate-500 truncate w-full text-center">{trend.month}</span>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Failure by Category */}
                <div className="glow-card p-6 flex flex-col">
                    <div className="mb-5">
                        <h3 className="text-lg font-bold text-white">Failure Frequency</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Incidents by Category</p>
                    </div>
                    <div className="flex-1 flex flex-col gap-5 justify-center">
                        {stats.failureByCategory.length === 0 ? (
                            <p className="text-slate-500 text-center text-sm">No failures recorded.</p>
                        ) : (
                            stats.failureByCategory.map(cat => (
                                <div key={cat.category}>
                                    <div className="flex justify-between text-sm mb-2">
                                        <span className="font-medium text-slate-300">{cat.categoryName}</span>
                                        <span className="text-slate-500 text-xs">{cat.count} incidents</span>
                                    </div>
                                    <div className="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden">
                                        <div className="h-full bg-gradient-to-r from-orange-500 to-red-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(cat.count * 10, 100)}%` }} />
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Detailed Log */}
            <div className="glow-card p-5">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-5">
                    <h3 className="text-lg font-bold text-white">Detailed Compliance Log</h3>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-700/50">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-[#0d1526] text-slate-500 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="px-4 py-3.5 border-b border-slate-700/50">Status</th>
                                <th className="px-4 py-3.5 border-b border-slate-700/50">Date & Time</th>
                                <th className="px-4 py-3.5 border-b border-slate-700/50">Device Name</th>
                                <th className="px-4 py-3.5 border-b border-slate-700/50">Category</th>
                                <th className="px-4 py-3.5 border-b border-slate-700/50">Checked By</th>
                                <th className="px-4 py-3.5 border-b border-slate-700/50">Notes</th>
                                <th className="px-4 py-3.5 border-b border-slate-700/50 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                            {reportData.length === 0 ? (
                                <tr><td colSpan={7} className="p-6 text-center text-slate-500">No data found for this period.</td></tr>
                            ) : (
                                reportData.map(item => (
                                    <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${item.status === 'OK' ? 'pill-ok' :
                                                item.status === 'Warning' ? 'pill-warning' : 'pill-error'
                                                }`}>
                                                <span className={`size-1.5 rounded-full ${item.status === 'OK' ? 'bg-green-500' :
                                                    item.status === 'Warning' ? 'bg-orange-500' : 'bg-red-500'
                                                    }`} />
                                                {item.status === 'OK' ? 'Healthy' : item.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-400">{item.date} {item.time}</td>
                                        <td className="px-4 py-3 text-white font-medium">{item.device}</td>
                                        <td className="px-4 py-3 text-slate-400">{item.category}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <div className="size-6 rounded-full bg-blue-500/15 flex items-center justify-center text-[10px] text-blue-400 font-bold">
                                                    {item.checker?.substring(0, 2).toUpperCase()}
                                                </div>
                                                <span className="text-slate-300">{item.checker}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-slate-400 max-w-[200px]">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate">{item.remarks || '-'}</span>
                                                {item.photo && (
                                                    <a href={item.photo} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 shrink-0" title="View photo">
                                                        <span className="material-symbols-outlined text-sm">photo</span>
                                                    </a>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <Link href={`/report/edit/${item.entryId}`} className="inline-flex items-center justify-center size-8 rounded-lg hover:bg-slate-700 text-blue-400 transition-colors" title="Edit">
                                                <span className="material-symbols-outlined text-[16px]">edit</span>
                                            </Link>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {totalPages > 1 && (
                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        totalItems={total}
                        pageSize={pageSize}
                    />
                )}
            </div>
        </main>
    );
}
