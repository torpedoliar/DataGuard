"use client";

import ActionButton from "@/components/ui/action-button";
import { incidentStatuses } from "@/lib/incidents";
import { CalendarDays, Filter } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const fieldClass = "ops-input h-9 px-3 text-sm";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted";

export default function ReportFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const formatDate = (date: Date) => date.toISOString().split("T")[0];

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
    <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-[minmax(160px,1fr)_minmax(160px,1fr)_minmax(180px,1fr)_auto] md:items-end xl:max-w-3xl">
      <label>
        <span className={labelClass}>Start Date</span>
        <div className="relative">
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className={`${fieldClass} w-full pl-9`}
          />
        </div>
      </label>

      <label>
        <span className={labelClass}>End Date</span>
        <input
          type="date"
          value={endDate}
          min={startDate}
          onChange={(event) => setEndDate(event.target.value)}
          className={`${fieldClass} w-full`}
        />
      </label>

      <label>
        <span className={labelClass}>Incident Status</span>
        <select
          value={incidentStatus}
          onChange={(event) => setIncidentStatus(event.target.value)}
          className={`${fieldClass} w-full`}
        >
          <option value="">All incidents</option>
          {incidentStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </label>

      <ActionButton type="button" onClick={handleApply} icon={<Filter className="size-4" />}>
        Filter
      </ActionButton>
    </div>
  );
}
