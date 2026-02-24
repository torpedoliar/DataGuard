"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function GridFilters() {
    const router = useRouter();
    const searchParams = useSearchParams();

    // Default to last 7 days calculation
    const today = new Date();
    const lastWeek = new Date(today);
    lastWeek.setDate(today.getDate() - 6);

    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    const currentStart = searchParams.get("startDate") || formatDate(lastWeek);
    const currentEnd = searchParams.get("endDate") || formatDate(today);
    const currentStatus = searchParams.get("status") || "All";

    const [startDate, setStartDate] = useState(currentStart);
    const [endDate, setEndDate] = useState(currentEnd);
    const [status, setStatus] = useState(currentStatus);

    const applyFilters = (newStart: string, newEnd: string, newStatus: string) => {
        router.push(`/grid?startDate=${newStart}&endDate=${newEnd}&status=${newStatus}`);
    };

    const handleApply = () => {
        applyFilters(startDate, endDate, status);
    };

    const handlePrev = () => {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diff = end.getTime() - start.getTime();
        const diffDays = diff / (1000 * 3600 * 24);

        start.setDate(start.getDate() - (diffDays + 1));
        end.setDate(end.getDate() - (diffDays + 1));

        const newStartStr = formatDate(start);
        const newEndStr = formatDate(end);
        setStartDate(newStartStr);
        setEndDate(newEndStr);
        applyFilters(newStartStr, newEndStr, status);
    };

    const handleNext = () => {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diff = end.getTime() - start.getTime();
        const diffDays = diff / (1000 * 3600 * 24);

        start.setDate(start.getDate() + (diffDays + 1));
        end.setDate(end.getDate() + (diffDays + 1));

        const newStartStr = formatDate(start);
        const newEndStr = formatDate(end);
        setStartDate(newStartStr);
        setEndDate(newEndStr);
        applyFilters(newStartStr, newEndStr, status);
    };

    return (
        <div className="flex flex-col sm:flex-row items-center gap-3">
            {/* Status Filter */}
            <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase text-slate-500 hidden sm:inline">Status:</span>
                <select
                    value={status}
                    onChange={(e) => {
                        setStatus(e.target.value);
                        applyFilters(startDate, endDate, e.target.value);
                    }}
                    className="bg-surface-dark border border-border-dark text-slate-300 text-sm rounded-lg focus:ring-primary focus:border-primary block p-2 custom-scrollbar focus:outline-none focus:ring-1"
                >
                    <option value="All">All Statuses</option>
                    <option value="OK">OK (Healthy)</option>
                    <option value="Warning">Warning</option>
                    <option value="Error">Critical (Error)</option>
                </select>
            </div>

            {/* Date Nav */}
            <div className="flex items-center bg-surface-dark border border-border-dark rounded-lg overflow-hidden shadow-sm">
                <button
                    title="Previous Period"
                    onClick={handlePrev}
                    className="p-2 text-slate-400 hover:text-white hover:bg-white/5 transition-colors border-r border-border-dark"
                >
                    <ChevronLeft className="w-4 h-4" />
                </button>

                <div className="flex items-center px-2">
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="bg-transparent border-none text-slate-300 text-sm focus:ring-0 focus:outline-none cursor-pointer w-[125px]"
                    />
                    <span className="text-slate-500 mx-1">-</span>
                    <input
                        type="date"
                        value={endDate}
                        min={startDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="bg-transparent border-none text-slate-300 text-sm focus:ring-0 focus:outline-none cursor-pointer w-[125px]"
                    />
                </div>

                <button
                    title="Apply Custom Range"
                    onClick={handleApply}
                    className="px-3 py-1 bg-primary/20 text-primary hover:bg-primary/30 text-xs font-medium border-l border-r border-border-dark transition-colors"
                >
                    GO
                </button>

                <button
                    title="Next Period"
                    onClick={handleNext}
                    className="p-2 text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
