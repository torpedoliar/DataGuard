
import { getDashboardStats } from "@/actions/dashboard";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function ChecklistPage() {
    const session = await verifySession();
    if (!session) redirect("/login");

    const stats = await getDashboardStats();

    // Format date
    const today = new Date();
    const formattedDate = today.toLocaleDateString("en-GB", { day: 'numeric', month: 'short', year: 'numeric' });
    const formattedTime = today.toLocaleTimeString("en-GB", { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

    // Total category stats sums
    const totalDevices = stats.categoryStats.reduce((sum, c) => sum + Number(c.total), 0);
    const totalChecked = stats.categoryStats.reduce((sum, c) => sum + Number(c.checked), 0);

    // Colors for category rings
    const ringColors = ["#22d3ee", "#22c55e", "#f97316", "#a78bfa", "#f43f5e"];

    return (
        <main className="flex-1 w-full max-w-[1600px] mx-auto px-5 py-6 flex flex-col gap-6" suppressHydrationWarning>
            {/* Page Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white font-display tracking-tight">Dashboard</h1>
                    <p className="text-slate-400 text-sm mt-0.5">Real-time overview of audit completion</p>
                </div>
                <div className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-sm font-medium">
                    <span className="material-symbols-outlined text-[18px] text-blue-400">calendar_today</span>
                    <span>{formattedDate} - {formattedTime}</span>
                </div>
            </div>

            {/* Main Dashboard Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                {/* Daily Audit Progress — Category Rings */}
                <div className="lg:col-span-5 glow-card p-6">
                    <h2 className="text-lg font-bold text-white mb-6">Daily Audit Progress</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
                        {stats.categoryStats.map((category, i) => {
                            const pct = category.percentage;
                            const color = ringColors[i % ringColors.length];
                            const r = 40;
                            const c = 2 * Math.PI * r;
                            const o = c - (pct / 100) * c;

                            return (
                                <div key={category.id} className="flex flex-col items-center gap-3 p-4 rounded-xl bg-slate-800/50 border border-slate-700/50">
                                    <div className="relative size-24 flex items-center justify-center">
                                        <svg className="size-full -rotate-90" viewBox="0 0 100 100">
                                            <circle cx="50" cy="50" r={r} fill="transparent" stroke="#1e293b" strokeWidth="6" />
                                            <circle
                                                cx="50" cy="50" r={r} fill="transparent"
                                                stroke={color}
                                                strokeWidth="6"
                                                strokeDasharray={c}
                                                strokeDashoffset={o}
                                                strokeLinecap="round"
                                                className="transition-all duration-1000 ease-out"
                                            />
                                        </svg>
                                        <span className="absolute text-xl font-bold text-white">{pct}%</span>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs font-bold text-white uppercase tracking-wider">{category.name}</p>
                                        <p className="text-[11px] text-slate-500 mt-0.5">{category.checked}/{category.total} Devices</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Overall Completion Donut */}
                <div className="lg:col-span-3 glow-card p-6 flex flex-col items-center justify-center">
                    <h2 className="text-lg font-bold text-white mb-4 self-start">Overall Completion</h2>
                    <div className="relative size-44 flex items-center justify-center mb-4">
                        <svg className="size-full -rotate-90" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="40" fill="transparent" stroke="#1e293b" strokeWidth="8" />
                            <circle
                                cx="50" cy="50" r="40" fill="transparent"
                                stroke="#3b82f6"
                                strokeWidth="8"
                                strokeDasharray={2 * Math.PI * 40}
                                strokeDashoffset={2 * Math.PI * 40 - (stats.overallCompletion / 100) * 2 * Math.PI * 40}
                                strokeLinecap="round"
                                className="transition-all duration-1000 ease-out"
                            />
                        </svg>
                        <div className="absolute flex flex-col items-center">
                            <span className="text-3xl font-bold text-white">{stats.overallCompletion}%</span>
                            <span className="text-[11px] text-slate-400">Total Completion</span>
                        </div>
                    </div>
                    {/* Category breakdown */}
                    <div className="flex flex-wrap gap-4 justify-center text-xs">
                        {stats.categoryStats.slice(0, 3).map((cat, i) => (
                            <div key={cat.id} className="flex items-center gap-1.5">
                                <div className="size-2 rounded-full" style={{ backgroundColor: ringColors[i % ringColors.length] }} />
                                <span className="text-slate-400">{cat.name}</span>
                                <span className="text-white font-medium">{cat.percentage}%</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Live Activity Feed */}
                <div className="lg:col-span-4 glow-card p-6 flex flex-col">
                    <h2 className="text-lg font-bold text-white mb-4">Live Activity Feed</h2>
                    <div className="flex-1 space-y-4 overflow-y-auto max-h-[400px] pr-1">
                        {stats.recentActivities.length === 0 ? (
                            <p className="text-slate-500 text-sm text-center py-8">No activity recorded today.</p>
                        ) : (
                            stats.recentActivities.map((activity) => (
                                <div key={activity.id} className="flex gap-3 group">
                                    <div className="flex flex-col items-center pt-1">
                                        <div className={`size-2.5 rounded-full shrink-0 ${activity.status === 'OK' ? 'bg-green-500' :
                                            activity.status === 'Error' ? 'bg-red-500' : 'bg-yellow-500'
                                            }`} />
                                        <div className="w-px flex-1 bg-slate-700/50 my-1 group-last:hidden" />
                                    </div>
                                    <div className="flex-1 pb-1 min-w-0">
                                        <div className="flex justify-between items-start gap-2">
                                            <p className="text-sm text-white font-medium truncate">{activity.device}</p>
                                            <span className="text-[11px] text-slate-500 whitespace-nowrap shrink-0">{activity.time}</span>
                                        </div>
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            <span className="text-slate-300 font-medium">{activity.user}</span> — {activity.category}
                                        </p>
                                        {activity.status !== 'OK' && (
                                            <div className={`mt-1.5 text-[11px] px-2.5 py-1.5 rounded-md inline-flex items-center gap-1.5 ${activity.status === 'Error'
                                                ? 'pill-error' : 'pill-warning'
                                                }`}>
                                                <span className="material-symbols-outlined text-[12px]">warning</span>
                                                {activity.status}{activity.remarks ? `: ${activity.remarks}` : ''}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Start Audit */}
                <div className="glow-card p-5 bg-gradient-to-br from-blue-600/20 to-blue-800/10 border-blue-500/20">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="size-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400">
                            <span className="material-symbols-outlined">assignment</span>
                        </div>
                        <div>
                            <h3 className="text-white font-bold text-sm">Start Auditing</h3>
                            <p className="text-slate-400 text-xs">Full checklist</p>
                        </div>
                    </div>
                    <Link href="/audit/new" className="block w-full text-center py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold transition-colors">
                        Full Audit
                    </Link>
                </div>

                {/* QR Scanner */}
                <div className="glow-card p-5">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="size-10 rounded-xl bg-cyan-500/20 flex items-center justify-center text-cyan-400">
                            <span className="material-symbols-outlined">qr_code_scanner</span>
                        </div>
                        <div>
                            <h3 className="text-white font-bold text-sm">Scan Device QR</h3>
                            <p className="text-slate-400 text-xs">Quick single-device audit</p>
                        </div>
                    </div>
                    <Link href="/audit/scan" className="block w-full text-center py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-semibold transition-colors">
                        Open Scanner
                    </Link>
                </div>

                {/* Stats Card: Total Devices */}
                <div className="glow-card p-5">
                    <div className="flex justify-between items-start mb-3">
                        <p className="text-slate-400 text-xs font-medium">Total Devices</p>
                        <div className="size-8 rounded-lg bg-green-500/10 flex items-center justify-center text-green-400">
                            <span className="material-symbols-outlined text-[18px]">dns</span>
                        </div>
                    </div>
                    <p className="text-3xl font-bold text-white">{totalDevices}</p>
                    <p className="text-xs text-slate-500 mt-1">{totalChecked} checked today</p>
                </div>

                {/* Stats Card: Completion */}
                <div className="glow-card p-5">
                    <div className="flex justify-between items-start mb-3">
                        <p className="text-slate-400 text-xs font-medium">Completion Rate</p>
                        <div className="size-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
                            <span className="material-symbols-outlined text-[18px]">check_circle</span>
                        </div>
                    </div>
                    <p className="text-3xl font-bold text-white">{stats.overallCompletion}%</p>
                    <div className="h-1.5 w-full rounded-full bg-slate-700 overflow-hidden mt-2">
                        <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${stats.overallCompletion}%` }} />
                    </div>
                </div>
            </div>
        </main>
    );
}
