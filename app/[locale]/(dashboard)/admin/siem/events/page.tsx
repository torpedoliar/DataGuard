import { getSiemEventExplorerData, type SiemEventFilters } from "@/actions/siem-events";
import SiemEventExplorer from "@/components/admin/siem-event-explorer";
import EmptyState from "@/components/ui/empty-state";
import { verifySession } from "@/lib/session";
import { FileSearch, SearchX } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(params: { [key: string]: string | string[] | undefined }): SiemEventFilters {
  const severity = firstParam(params.severity);
  const page = firstParam(params.page);
  const eventIds = firstParam(params.eventIds);

  return {
    page: page ? Number(page) : 1,
    q: firstParam(params.q),
    status: firstParam(params.status) as SiemEventFilters["status"],
    category: firstParam(params.category),
    normalizedType: firstParam(params.normalizedType),
    severity: severity ? Number(severity) : undefined,
    sourceIp: firstParam(params.sourceIp),
    eventIds: eventIds ? eventIds.split(",").map(Number).filter((n) => Number.isFinite(n)) : undefined,
    start: firstParam(params.start),
    end: firstParam(params.end),
  };
}

export default async function SiemEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");
  if (!session.activeSiteId) redirect("/select-site");

  const params = await searchParams;
  const data = await getSiemEventExplorerData(parseFilters(params));

  return (
    <div className="mx-auto max-w-[1800px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
            <FileSearch className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">SIEM Event Explorer</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Search parsed syslog events, inspect raw ingest, and flag injection-like payloads safely.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/siem/sources" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            Sources
          </Link>
          <Link href="/admin" className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300">
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to Admin
          </Link>
        </div>
      </div>

      {"message" in data && data.message ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{data.message}</div>
      ) : data.events.length === 0 && data.rawEvents.length === 0 ? (
        <EmptyState
          icon={<SearchX className="size-5" />}
          title="No SIEM events found"
          description="No parsed or raw events match the current filters. Adjust filters or wait for syslog ingest from known sources."
        />
      ) : (
        <SiemEventExplorer data={data} />
      )}
    </div>
  );
}
