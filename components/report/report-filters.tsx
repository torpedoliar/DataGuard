
"use client";

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

    const [startDate, setStartDate] = useState(currentStart);
    const [endDate, setEndDate] = useState(currentEnd);

    const handleApply = () => {
        router.push(`/report?startDate=${startDate}&endDate=${endDate}`);
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
