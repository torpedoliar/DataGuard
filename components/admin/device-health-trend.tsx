"use client";

import { useEffect, useState } from "react";
import { getDeviceHealthHistory, DailyHealth } from "@/actions/analytics";
import { Loader2, Activity } from "lucide-react";
import clsx from "clsx";

export default function DeviceHealthTrend({ deviceId, days = 30 }: { deviceId: number, days?: number }) {
    const requestKey = `${deviceId}:${days}`;
    const [result, setResult] = useState<{ key: string; history: DailyHealth[] } | null>(null);
    const history = result?.history ?? [];
    const isLoading = result?.key !== requestKey;

    useEffect(() => {
        let cancelled = false;
        getDeviceHealthHistory(deviceId, days).then((data) => {
            if (!cancelled) setResult({ key: requestKey, history: data });
        }).catch((err) => {
            console.error("Failed to load device health history:", err);
            if (!cancelled) setResult({ key: requestKey, history: [] });
        });
        return () => {
            cancelled = true;
        };
    }, [deviceId, days, requestKey]);

    if (isLoading) {
        return (
            <div className="ops-panel-subtle flex items-center justify-center p-6">
                <Loader2 className="size-5 animate-spin text-ops-muted" />
                <span className="ml-3 text-[13px] text-ops-muted">Loading health history…</span>
            </div>
        );
    }

    // Colors mapping
    const getStatusColor = (status: DailyHealth["status"]) => {
        switch (status) {
            case "OK": return "bg-ops-success";
            case "NOT OK": return "bg-ops-danger";
            case "Unchecked": return "bg-ops-surface-raised";
        }
    };

    const getStatusText = (status: DailyHealth["status"]) => {
        switch (status) {
            case "OK": return "Healthy";
            case "NOT OK": return "Not OK";
            case "Unchecked": return "No Data";
        }
    };

    // Calculate summary statistics
    let okCount = 0;
    let notOkCount = 0;

    for (const h of history) {
        if (h.status === "OK") okCount++;
        if (h.status === "NOT OK") notOkCount++;
    }

    const totalChecks = okCount + notOkCount;
    const uptimeRatio = totalChecks > 0 ? ((okCount / totalChecks) * 100).toFixed(1) : "0.0";

    return (
        <div className="ops-panel mt-6 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <div className="rounded-md bg-ops-info-soft p-1.5 text-ops-info">
                        <Activity className="size-4" />
                    </div>
                    <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Device health history ({days} days)</h3>
                </div>
                {totalChecks > 0 && (
                    <span className="text-[13px] text-ops-muted">
                        Reliability: <span className={clsx("font-medium tabular-nums", Number(uptimeRatio) > 90 ? "text-ops-success" : "text-ops-warning")}>{uptimeRatio}%</span>
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
                        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-ops-border bg-ops-surface px-2 py-1 text-xs text-ops-text opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                            {new Date(day.date).toLocaleDateString("en-GB", { month: "short", day: "numeric" })}: {getStatusText(day.status)}
                        </div>
                    </div>
                ))}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-ops-muted">
                <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm bg-ops-success"></div> OK ({okCount})
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm bg-ops-danger"></div> NOT OK ({notOkCount})
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm bg-ops-surface-raised"></div> Unchecked
                </div>
            </div>
        </div>
    );
}
