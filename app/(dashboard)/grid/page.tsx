import { Fragment, type ReactNode } from "react";
import { getAuditGridData, type DailyCheck } from "@/actions/grid";
import GridFilters from "@/components/grid/grid-filters";
import PageHeader from "@/components/ui/page-header";
import DraggableScroll from "@/components/ui/draggable-scroll";
import { verifySession } from "@/lib/session";
import { AlertTriangle, CheckCircle2, Circle, Grid3X3, XCircle } from "lucide-react";
import { redirect } from "next/navigation";
import clsx from "clsx";

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
  const todayIso = new Date().toISOString().split("T")[0];
  const rangeLabel = dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : "No date range";

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const dayName = date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
    const dateMonth = date.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" });
    return { dayName, dateMonth };
  };

  const filteredGridData = statusFilter && statusFilter !== "All"
    ? gridData.filter((device) => {
        return dates.some((date) => {
          const checks = device.statusHistory[date] || [];
          return checks.some((check) => check.status === statusFilter);
        });
      })
    : gridData;

  const groupedData = filteredGridData.reduce((acc, device) => {
    const categoryName = device.categoryName || "Uncategorized";
    if (!acc[categoryName]) {
      acc[categoryName] = {
        color: device.categoryColor || "#5dd4b4",
        devices: [],
      };
    }
    acc[categoryName].devices.push(device);
    return acc;
  }, {} as Record<string, { color: string; devices: typeof gridData }>);

  return (
    <main className="flex h-[calc(100vh-56px)] w-full flex-col overflow-hidden bg-ops-bg">
      <header className="flex-none border-b border-ops-border bg-ops-surface px-4 py-4 lg:px-6">
        <div className="mx-auto max-w-[1600px]">
          <PageHeader
            eyebrow="Operate / Audit Grid"
            title="Audit Grid"
            description={`Sticky matrix for ${rangeLabel}. Drag horizontally to inspect daily device checks.`}
            actions={<GridFilters />}
          />
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-ops-muted">
            <LegendItem icon={<CheckCircle2 className="size-4 text-emerald-300" />} label="OK" />
            <LegendItem icon={<AlertTriangle className="size-4 text-amber-300" />} label="Warning" />
            <LegendItem icon={<XCircle className="size-4 text-red-300" />} label="Error" />
            <LegendItem icon={<Circle className="size-4 text-slate-600" />} label="No check" />
          </div>
        </div>
      </header>

      <DraggableScroll className="relative flex-1 overflow-auto">
        <div className="inline-block min-w-full align-middle">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-ops-surface text-[11px] font-semibold uppercase tracking-[0.08em] text-ops-muted">
              <tr>
                <th className="sticky left-0 top-0 z-50 min-w-[300px] border-b border-r border-ops-border bg-ops-surface py-3 pl-5 pr-3 shadow-[4px_0_16px_rgba(0,0,0,0.32)]">
                  Device Name
                </th>
                {dates.map((date) => {
                  const { dayName, dateMonth } = formatDate(date);
                  const isToday = date === todayIso;

                  return (
                    <th
                      key={date}
                      className={clsx(
                        "sticky top-0 z-40 min-w-[104px] border-b border-r border-ops-border px-3 py-3 text-center",
                        isToday ? "border-t-2 border-t-ops-accent bg-ops-accent/10" : "bg-ops-surface",
                      )}
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className={clsx("text-[10px]", isToday ? "text-[#b7f5e4]" : "text-ops-muted")}>
                          {dayName}
                        </span>
                        <span className="font-mono text-slate-300">{dateMonth}</span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-ops-border/55">
              {Object.entries(groupedData).length === 0 ? (
                <tr>
                  <td colSpan={dates.length + 1} className="px-5 py-12 text-center">
                    <Grid3X3 className="mx-auto size-8 text-ops-muted" />
                    <p className="mt-3 font-semibold text-ops-text">No grid data found</p>
                    <p className="mt-1 text-sm text-ops-muted">Change the date range or status filter.</p>
                  </td>
                </tr>
              ) : (
                Object.entries(groupedData).map(([categoryName, { color, devices }]) => (
                  <Fragment key={categoryName}>
                    <tr className="bg-ops-surface">
                      <td
                        colSpan={dates.length + 1}
                        className="sticky left-0 z-30 border-b border-r border-ops-border bg-ops-surface py-2 pl-5 pr-3 shadow-[4px_0_16px_rgba(0,0,0,0.32)]"
                      >
                        <div className="flex items-center gap-2">
                          <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
                          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-300">
                            {categoryName}
                          </span>
                          <span className="font-mono text-[11px] text-ops-muted">({devices.length})</span>
                        </div>
                      </td>
                    </tr>

                    {devices.map((device) => (
                      <tr key={device.id} className="group transition-colors hover:bg-ops-surface">
                        <td className="sticky left-0 z-20 whitespace-nowrap border-r border-ops-border bg-ops-bg py-2.5 pl-8 pr-3 shadow-[4px_0_16px_rgba(0,0,0,0.32)] group-hover:bg-ops-surface">
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold text-ops-text">{device.name}</span>
                            <span className="font-mono text-[11px] text-ops-muted">{device.locationName || "-"}</span>
                          </div>
                        </td>
                        {dates.map((date) => {
                          const checks: DailyCheck[] = device.statusHistory[date] || [];
                          const isToday = date === todayIso;

                          return (
                            <td
                              key={date}
                              className={clsx(
                                "whitespace-nowrap border-r border-ops-border/45 px-2 py-2 text-center align-top transition-colors hover:bg-white/[0.03]",
                                isToday && "bg-ops-accent/[0.045]",
                              )}
                            >
                              {checks.length === 0 ? (
                                <div className="flex min-h-8 items-center justify-center">
                                  <Circle className="size-3.5 text-slate-700" />
                                </div>
                              ) : (
                                <div className="flex flex-col items-center justify-center gap-1">
                                  {checks.map((check, index) => (
                                    <GridStatusPill key={`${check.time}-${index}`} check={check} />
                                  ))}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </DraggableScroll>
    </main>
  );
}

function LegendItem({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-ops-border bg-ops-bg px-2.5 py-1">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function GridStatusPill({ check }: { check: DailyCheck }) {
  const icon = check.status === "OK"
    ? <CheckCircle2 className="size-3.5 text-emerald-300" />
    : check.status === "Warning"
      ? <AlertTriangle className="size-3.5 text-amber-300" />
      : <XCircle className="size-3.5 text-red-300" />;

  return (
    <div
      className={clsx(
        "group/tooltip relative flex items-center gap-1 rounded-full border px-2 py-0.5",
        check.status === "OK" && "border-emerald-400/25 bg-emerald-400/10",
        check.status === "Warning" && "border-amber-400/25 bg-amber-400/10",
        check.status === "Error" && "border-red-400/25 bg-red-400/10",
      )}
      title={`${check.shift} Shift @ ${check.time}`}
    >
      <span className="max-w-[54px] truncate text-[10px] font-semibold text-slate-300">{check.username}</span>
      {icon}
      <div className="pointer-events-none absolute -top-8 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md border border-ops-border bg-ops-surface-raised px-2.5 py-1 text-[10px] text-ops-text opacity-0 transition-opacity group-hover/tooltip:opacity-100">
        {check.shift} | {check.time}
      </div>
    </div>
  );
}
