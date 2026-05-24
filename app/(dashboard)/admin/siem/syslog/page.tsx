import { getSiemSyslogData, type SiemSyslogFilters } from "@/actions/siem-syslog";
import SiemSyslogTable from "@/components/admin/siem-syslog-table";
import ActionButton from "@/components/ui/action-button";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { FileSearch, RadioTower, ShieldAlert } from "lucide-react";
import { redirect } from "next/navigation";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(params: { [key: string]: string | string[] | undefined }): SiemSyslogFilters {
  const deviceId = firstParam(params.deviceId);
  const severity = firstParam(params.severity);
  const facility = firstParam(params.facility);
  const page = firstParam(params.page);

  return {
    page: page ? Number(page) : 1,
    q: firstParam(params.q),
    deviceId: deviceId ? Number(deviceId) : undefined,
    sourceIp: firstParam(params.sourceIp),
    severity: severity ? Number(severity) : undefined,
    facility: facility ? Number(facility) : undefined,
    start: firstParam(params.start),
    end: firstParam(params.end),
  };
}

export default async function SiemSyslogPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");
  if (!session.activeSiteId) redirect("/select-site");

  const params = await searchParams;
  const data = await getSiemSyslogData(parseFilters(params));

  return (
    <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        eyebrow="SIEM / Syslog"
        title="Device Syslog Messages"
        description="View parsed syslog messages, severity, facility, source IP, and device mapping for active-site devices."
        actions={
          <>
            <ActionButton href="/admin/siem/events" variant="secondary" icon={<FileSearch className="size-4" />}>Event Explorer</ActionButton>
            <ActionButton href="/admin/siem/findings" variant="secondary" icon={<ShieldAlert className="size-4" />}>Findings</ActionButton>
            <ActionButton href="/admin/siem/sources" variant="secondary" icon={<RadioTower className="size-4" />}>Sources</ActionButton>
          </>
        }
      />

      {"message" in data && data.message ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{data.message}</div>
      ) : (
        <SiemSyslogTable data={data} />
      )}
    </main>
  );
}
