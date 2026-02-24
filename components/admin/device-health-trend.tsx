"use client";

import { useEffect, useState } from "react";
import { getDeviceHealthHistory, DailyHealth } from "@/actions/analytics";
import { Loader2, Activity } from "lucide-react";
import clsx from "clsx";

export default function DeviceHealthTrend({ deviceId, days = 30 }: { deviceId: number, days?: number }) {
    const [history, setHistory] = useState<DailyHealth[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        setIsLoading(true);
        getDeviceHealthHistory(deviceId, days).then((data) => {
            setHistory(data);
            setIsLoading(false);
        }).catch((err) => {
            console.error("Failed to load device health history:", err);
            setIsLoading(false);
        });
    }, [deviceId, days]);

    if (isLoading) {
        return (
            <div className="flex justify-center items-center p-6 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                <span className="ml-3 text-sm text-slate-500">Loading health history...</span>
            </div>
        );
    }

    // Colors mapping
    const getStatusColor = (status: DailyHealth["status"]) => {
        switch (status) {
            case "OK": return "bg-green-500";
            case "Warning": return "bg-yellow-400";
            case "Error": return "bg-red-500";
            case "Unchecked": return "bg-slate-200 dark:bg-slate-700";
        }
    };

    const getStatusText = (status: DailyHealth["status"]) => {
        switch (status) {
            case "OK": return "Healthy";
            case "Warning": return "Warnings";
            case "Error": return "Critical Issues";
            case "Unchecked": return "No Data";
        }
    };

    // Calculate summary statistics
    let okCount = 0;
    let warnCount = 0;
    let errCount = 0;

    for (const h of history) {
        if (h.status === "OK") okCount++;
        if (h.status === "Warning") warnCount++;
        if (h.status === "Error") errCount++;
    }

    const totalChecks = okCount + warnCount + errCount;
    const uptimeRatio = totalChecks > 0 ? ((okCount / totalChecks) * 100).toFixed(1) : "0.0";

    return (
        <div className="bg-white dark:bg-card-dark rounded-xl border border-slate-200 dark:border-slate-700 p-5 mt-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">
                        <Activity className="h-4 w-4" />
                    </div>
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Device Health History ({days} Days)</h3>
                </div>
                {totalChecks > 0 && (
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        Reliability: <span className={clsx(Number(uptimeRatio) > 90 ? "text-green-600 dark:text-green-400" : "text-yellow-600 dark:text-yellow-400")}>{uptimeRatio}%</span>
                    </span>
                )}
            </div>

            {/* Heatmap Grid */}
            <div className="flex flex-wrap gap-1.5 mb-4">
                {history.map((day, idx) => (
                    <div
                        key={idx}
                        className={clsx("w-3 h-8 sm:w-4 sm:h-10 rounded-sm transition-transform hover:scale-110 cursor-pointer group relative", getStatusColor(day.status))}
                    >
                        {/* Tooltip */}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10 transition-opacity">
                            {new Date(day.date).toLocaleDateString("en-GB", { month: "short", day: "numeric" })}: {getStatusText(day.status)}
                        </div>
                    </div>
                ))}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm bg-green-500"></div> OK ({okCount})
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm bg-yellow-400"></div> Warning ({warnCount})
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm bg-red-500"></div> Error ({errCount})
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm bg-slate-200 dark:bg-slate-700"></div> Unchecked
                </div>
            </div>
        </div>
    );
}
