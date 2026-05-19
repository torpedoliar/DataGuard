"use client";

import ActionButton from "@/components/ui/action-button";
import { ChevronLeft, ChevronRight, Filter } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const fieldClass = "ops-input h-9 px-3 text-sm";

export default function GridFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const today = new Date();
  const lastWeek = new Date(today);
  lastWeek.setDate(today.getDate() - 6);

  const formatDate = (date: Date) => date.toISOString().split("T")[0];

  const currentStart = searchParams.get("startDate") || formatDate(lastWeek);
  const currentEnd = searchParams.get("endDate") || formatDate(today);
  const currentStatus = searchParams.get("status") || "All";

  const [startDate, setStartDate] = useState(currentStart);
  const [endDate, setEndDate] = useState(currentEnd);
  const [status, setStatus] = useState(currentStatus);

  const applyFilters = (newStart: string, newEnd: string, newStatus: string) => {
    const params = new URLSearchParams();
    params.set("startDate", newStart);
    params.set("endDate", newEnd);
    params.set("status", newStatus);
    router.push(`/grid?${params.toString()}`);
  };

  const handleApply = () => {
    applyFilters(startDate, endDate, status);
  };

  const shiftWindow = (direction: -1 | 1) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diff = end.getTime() - start.getTime();
    const diffDays = diff / (1000 * 3600 * 24);
    const offset = (diffDays + 1) * direction;

    start.setDate(start.getDate() + offset);
    end.setDate(end.getDate() + offset);

    const newStartStr = formatDate(start);
    const newEndStr = formatDate(end);
    setStartDate(newStartStr);
    setEndDate(newEndStr);
    applyFilters(newStartStr, newEndStr, status);
  };

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto xl:flex-row xl:items-center">
      <label className="sr-only" htmlFor="grid-status-filter">Status</label>
      <select
        id="grid-status-filter"
        value={status}
        onChange={(event) => {
          setStatus(event.target.value);
          applyFilters(startDate, endDate, event.target.value);
        }}
        className={`${fieldClass} min-w-40`}
      >
        <option value="All">All Statuses</option>
        <option value="OK">OK (Healthy)</option>
        <option value="Warning">Warning</option>
        <option value="Error">Critical (Error)</option>
      </select>

      <div className="flex items-center overflow-hidden rounded-md border border-ops-border bg-ops-bg">
        <ActionButton
          type="button"
          variant="ghost"
          size="icon"
          title="Previous period"
          onClick={() => shiftWindow(-1)}
          className="rounded-none border-0"
        >
          <ChevronLeft className="size-4" />
        </ActionButton>

        <div className="flex items-center gap-1 px-2">
          <label className="sr-only" htmlFor="grid-start-date">Start date</label>
          <input
            id="grid-start-date"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="h-9 w-[128px] bg-transparent text-sm text-ops-text outline-none"
          />
          <span className="text-ops-muted">-</span>
          <label className="sr-only" htmlFor="grid-end-date">End date</label>
          <input
            id="grid-end-date"
            type="date"
            value={endDate}
            min={startDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="h-9 w-[128px] bg-transparent text-sm text-ops-text outline-none"
          />
        </div>

        <ActionButton
          type="button"
          variant="secondary"
          size="sm"
          title="Apply custom range"
          onClick={handleApply}
          icon={<Filter className="size-4" />}
          className="h-9 rounded-none border-y-0 border-r-0"
        >
          Go
        </ActionButton>

        <ActionButton
          type="button"
          variant="ghost"
          size="icon"
          title="Next period"
          onClick={() => shiftWindow(1)}
          className="rounded-none border-0"
        >
          <ChevronRight className="size-4" />
        </ActionButton>
      </div>
    </div>
  );
}
