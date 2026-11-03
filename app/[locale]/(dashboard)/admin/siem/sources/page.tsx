import { getSiemSources } from "@/actions/siem-sources";
import SiemSourceTable from "@/components/admin/siem-source-table";
import ActionButton from "@/components/ui/action-button";
import EmptyState from "@/components/ui/empty-state";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { Radio, ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";

export default async function SiemSourcesPage() {
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");
  if (!session.activeSiteId) redirect("/select-site");

  const data = await getSiemSources();

  return (
    <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader
        eyebrow="Admin / SIEM"
        title="SIEM source management"
        description="Map syslog sources to active-site devices and parser profiles."
        actions={<ActionButton href="/admin" variant="ghost" icon={<ArrowLeft className="size-4" />}>Back to Admin</ActionButton>}
      />

      {"message" in data && data.message ? (
        <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">{data.message}</div>
      ) : data.sources.length === 0 ? (
        <EmptyState
          icon={<Radio className="size-5" />}
          title="No SIEM sources yet"
          description="Unknown syslog sources appear here after packets arrive and unknown-source handling is enabled. Add a source mapping once an unknown source is detected."
        />
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Known syslog sources</h2>
              <p className="mt-0.5 text-[13px] text-ops-muted">Unmapped sources will not create incidents until linked to a device.</p>
            </div>
            <span className="text-xs font-medium tabular-nums text-ops-muted">
              {data.sources.length.toLocaleString()} sources
            </span>
          </div>
          <SiemSourceTable sources={data.sources} devices={data.devices} />
        </section>
      )}
    </main>
  );
}
