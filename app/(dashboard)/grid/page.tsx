import React from "react";
import { getAuditGridData, type DailyCheck } from "@/actions/grid";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import GridFilters from "@/components/grid/grid-filters";
import DraggableScroll from "@/components/ui/draggable-scroll";

export default async function AuditGridPage({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
    const session = await verifySession();
    if (!session) redirect("/login");

    const params = await searchParams;
    const startDate = params.startDate as string | undefined;
    const endDate = params.endDate as string | undefined;
    const statusFilter = params.status as string | undefined;

    const { dates, gridData } = await getAuditGridData(startDate, endDate);

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        const dayName = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
        const dateMonth = d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' });
        return { dayName, dateMonth };
    };

    const filteredGridData = statusFilter && statusFilter !== "All"
        ? gridData.filter(device => {
            return dates.some(date => {
                const checks = device.statusHistory[date] || [];
                return checks.some(c => c.status === statusFilter);
            });
        })
        : gridData;

    const groupedData = filteredGridData.reduce((acc, device) => {
        const cat = device.categoryName || 'Uncategorized';
        if (!acc[cat]) {
            acc[cat] = {
                color: device.categoryColor || '#3b82f6',
                devices: []
            };
        }
        acc[cat].devices.push(device);
        return acc;
    }, {} as Record<string, { color: string, devices: typeof gridData }>);

    return (
        <main className="flex-1 w-full h-[calc(100vh-56px)] overflow-hidden bg-[#0b1120] flex flex-col">
            <header className="flex-none h-14 border-b border-slate-800 bg-[#0d1526] flex items-center justify-between px-5 z-40">
                <div className="flex items-center gap-3">
                    <div className="size-8 rounded-lg bg-blue-500/15 flex items-center justify-center text-blue-400">
                        <span className="material-symbols-outlined text-[20px]">dns</span>
                    </div>
                    <div>
                        <h1 className="text-white text-base font-bold leading-tight font-display">Audit Grid</h1>
                        <p className="text-slate-500 text-[11px] font-medium">Last 7 Days</p>
                    </div>
                </div>
                <GridFilters />
            </header>

            <DraggableScroll className="flex-1 overflow-auto relative w-full">
                <div className="inline-block min-w-full align-middle">
                    <table className="min-w-full divide-y divide-slate-800 border-collapse text-left text-sm">
                        <thead className="bg-[#0d1526] text-[11px] uppercase font-semibold text-slate-500 tracking-wider">
                            <tr>
                                <th className="sticky-corner top-0 left-0 bg-[#0d1526] z-40 border-b border-r border-slate-800 py-3 pl-5 pr-3 min-w-[280px] w-[280px] shadow-[4px_0_16px_rgba(0,0,0,0.4)]">
                                    <span>Device Name</span>
                                </th>
                                {dates.map((date) => {
                                    const { dayName, dateMonth } = formatDate(date);
                                    const isToday = date === new Date().toISOString().split('T')[0];
                                    return (
                                        <th key={date} className={`sticky top-0 z-30 border-b border-slate-800 px-3 py-3 text-center min-w-[100px] ${isToday ? 'bg-blue-500/10 border-t-2 border-t-blue-500' : 'bg-[#0d1526]'}`}>
                                            <div className="flex flex-col gap-0.5">
                                                <span className={`${isToday ? 'text-blue-400' : 'text-slate-600'} text-[10px]`}>{dayName}</span>
                                                <span className="text-slate-300 font-mono">{dateMonth}</span>
                                            </div>
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                            {Object.entries(groupedData).map(([categoryName, { color, devices }]) => (
                                <React.Fragment key={categoryName}>
                                    <tr className="bg-[#0d1526]">
                                        <td
                                            colSpan={dates.length + 1}
                                            className="sticky left-0 bg-[#0d1526] z-20 py-2 pl-5 pr-3 border-r border-b border-slate-800 shadow-[4px_0_16px_rgba(0,0,0,0.4)]"
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                                                <span className="font-bold text-[11px] uppercase tracking-wider text-slate-300">{categoryName}</span>
                                                <span className="text-[11px] text-slate-600 font-mono ml-1.5">({devices.length})</span>
                                            </div>
                                        </td>
                                    </tr>

                                    {devices.map((device) => (
                                        <tr key={device.id} className="group hover:bg-slate-800/30 transition-colors">
                                            <td className="sticky left-0 bg-[#0b1120] group-hover:bg-[#111827] whitespace-nowrap py-2.5 pl-8 pr-3 border-r border-slate-800 shadow-[4px_0_16px_rgba(0,0,0,0.4)] z-20">
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-white text-sm">{device.name}</span>
                                                    <span className="text-[11px] text-slate-500 font-mono">{device.locationName || "-"}</span>
                                                </div>
                                            </td>
                                            {dates.map((date) => {
                                                const checks: DailyCheck[] = device.statusHistory[date] || [];
                                                return (
                                                    <td key={date} className="whitespace-nowrap px-2 py-2 text-center border-r border-slate-800/30 hover:bg-white/[0.02] transition-colors align-top">
                                                        {checks.length === 0 ? (
                                                            <div className="flex justify-center items-center h-full">
                                                                <span className="material-symbols-outlined text-slate-700/40 text-[16px]">radio_button_unchecked</span>
                                                            </div>
                                                        ) : (
                                                            <div className="flex flex-col gap-1 items-center justify-center">
                                                                {checks.map((check, idx) => (
                                                                    <div
                                                                        key={idx}
                                                                        className="flex items-center gap-1 bg-slate-800/60 rounded-full pl-2 pr-1.5 py-0.5 border border-slate-700/30 group/tooltip relative"
                                                                        title={`${check.shift} Shift @ ${check.time}`}
                                                                    >
                                                                        <span className="text-[10px] font-medium text-slate-400 max-w-[50px] truncate">{check.username}</span>
                                                                        {check.status === 'OK' && <span className="material-symbols-outlined text-green-500 text-[14px]">check_circle</span>}
                                                                        {check.status === 'Error' && <span className="material-symbols-outlined text-red-500 text-[14px]">cancel</span>}
                                                                        {check.status === 'Warning' && <span className="material-symbols-outlined text-orange-500 text-[14px]">warning</span>}

                                                                        <div className="absolute opacity-0 group-hover/tooltip:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] rounded-lg px-2.5 py-1 -top-8 left-1/2 -translate-x-1/2 pointer-events-none whitespace-nowrap z-50 border border-slate-700">
                                                                            {check.shift} • {check.time}
                                                                            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            </DraggableScroll>
            <style>{`
                .sticky-corner {
                    position: sticky;
                    left: 0;
                    z-index: 50;
                }
            `}</style>
        </main>
    );
}
