import { getSiemSources } from "@/actions/siem-sources";
import SiemSourceTable from "@/components/admin/siem-source-table";
import EmptyState from "@/components/ui/empty-state";
import { verifySession } from "@/lib/session";
import { RadioTower, Radio, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function SiemSourcesPage() {
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");
  if (!session.activeSiteId) redirect("/select-site");

  const data = await getSiemSources();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-ops-info-soft text-ops-info">
            <RadioTower className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-ops-text">SIEM Source Management</h1>
            <p className="text-sm text-ops-muted">Map syslog sources to active-site devices and parser profiles.</p>
          </div>
        </div>
        <Link href="/admin" className="flex items-center gap-1 text-sm font-medium text-ops-info hover:text-ops-info">
          <ArrowLeft className="size-[18px]" />
          Back to Admin
        </Link>
      </div>

      {"message" in data && data.message ? (
        <div className="rounded-lg border border-ops-danger/30 bg-ops-danger-soft p-4 text-sm text-ops-danger">{data.message}</div>
      ) : data.sources.length === 0 ? (
        <EmptyState
          icon={<Radio className="size-5" />}
          title="No SIEM sources yet"
          description="Unknown syslog sources appear here after packets arrive and unknown-source handling is enabled. Add a source mapping once an unknown source is detected."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-ops-border bg-ops-surface shadow-sm">
          <div className="flex items-center justify-between border-b border-ops-border px-6 py-4">
            <div>
              <h3 className="text-lg font-semibold text-ops-text">Known Syslog Sources</h3>
              <p className="text-sm text-ops-muted">Unmapped sources will not create incidents until linked to a device.</p>
            </div>
            <span className="rounded-full bg-ops-surface-raised px-3 py-1 text-xs font-medium text-ops-muted">
              {data.sources.length} Sources
            </span>
          </div>
          <SiemSourceTable sources={data.sources} devices={data.devices} />
        </div>
      )}
    </div>
  );
}
