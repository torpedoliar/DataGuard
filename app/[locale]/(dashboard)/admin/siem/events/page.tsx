import { getSiemEventExplorerData, type SiemEventFilters } from "@/actions/siem-events";
import SiemEventExplorer from "@/components/admin/siem-event-explorer";
import ActionButton from "@/components/ui/action-button";
import EmptyState from "@/components/ui/empty-state";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { SearchX, ArrowLeft } from "lucide-react";
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
    <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader
        eyebrow="Admin / SIEM"
        title="SIEM event explorer"
        description="Search parsed syslog events, inspect raw ingest, and flag injection-like payloads safely."
        actions={
          <>
            <ActionButton href="/admin/siem/sources" variant="secondary">Sources</ActionButton>
            <ActionButton href="/admin" variant="ghost" icon={<ArrowLeft className="size-4" />}>Back to Admin</ActionButton>
          </>
        }
      />

      {"message" in data && data.message ? (
        <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">{data.message}</div>
      ) : data.events.length === 0 && data.rawEvents.length === 0 ? (
        <EmptyState
          icon={<SearchX className="size-5" />}
          title="No SIEM events found"
          description="No parsed or raw events match the current filters. Adjust filters or wait for syslog ingest from known sources."
        />
      ) : (
        <SiemEventExplorer data={data} />
      )}
    </main>
  );
}
