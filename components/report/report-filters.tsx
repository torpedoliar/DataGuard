
"use client";

import { incidentStatuses } from "@/lib/incidents";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export default function ReportFilters() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

    // Format YYYY-MM-DD
    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    const currentStart = searchParams.get("startDate") || formatDate(firstDay);
    const currentEnd = searchParams.get("endDate") || formatDate(today);
    const currentIncidentStatus = searchParams.get("incidentStatus") || "";

    const [startDate, setStartDate] = useState(currentStart);
    const [endDate, setEndDate] = useState(currentEnd);
    const [incidentStatus, setIncidentStatus] = useState(currentIncidentStatus);

    const handleApply = () => {
        const params = new URLSearchParams();
        params.set("startDate", startDate);
        params.set("endDate", endDate);
        if (incidentStatus) params.set("incidentStatus", incidentStatus);
        router.push(`/report?${params.toString()}`);
    };

    return (
        <div className="flex flex-col sm:flex-row items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm">
                <span className="material-symbols-outlined text-slate-400 text-[20px]">date_range</span>
                <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="text-sm font-medium border-none bg-transparent focus:outline-none text-slate-700 dark:text-slate-200 cursor-pointer"
                />
                <span className="text-slate-400 dark:text-slate-500 font-medium">to</span>
                <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    min={startDate}
                    className="text-sm font-medium border-none bg-transparent focus:outline-none text-slate-700 dark:text-slate-200 cursor-pointer"
                />
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm">
                <span className="material-symbols-outlined text-slate-400 text-[20px]">report_problem</span>
                <select
                    value={incidentStatus}
                    onChange={(event) => setIncidentStatus(event.target.value)}
                    className="text-sm font-medium bg-transparent text-slate-700 dark:text-slate-200 focus:outline-none"
                >
                    <option value="">All incidents</option>
                    {incidentStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
            </div>
            <button
                onClick={handleApply}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium text-sm transition-colors shadow-sm"
                title="Apply Filter"
            >
                Filter
            </button>
        </div>
    );
}
