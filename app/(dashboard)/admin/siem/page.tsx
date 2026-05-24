import { getSiemDashboardStats } from "@/actions/siem-dashboard";
import SiemDashboard from "@/components/admin/siem-dashboard";
import ActionButton from "@/components/ui/action-button";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { FileSearch, RadioTower, ScrollText, ShieldAlert } from "lucide-react";
import { redirect } from "next/navigation";

export default async function SiemPage() {
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");
  if (!session.activeSiteId) redirect("/select-site");

  const data = await getSiemDashboardStats();

  if ("message" in data) {
    return (
      <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-4 py-5 lg:px-6">
        <PageHeader
          eyebrow="Admin / SIEM"
          title="SIEM Dashboard"
          description="Syslog ingestion, event parsing, rule findings, source mapping, and alert delivery for the active site."
        />
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{data.message}</div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        eyebrow="Admin / SIEM"
        title="SIEM Dashboard"
        description="Syslog ingestion, event parsing, rule findings, source mapping, and alert delivery for the active site."
        actions={
          <>
            <ActionButton href="/admin/siem/syslog" variant="secondary" icon={<ScrollText className="size-4" />}>Syslog</ActionButton>
            <ActionButton href="/admin/siem/events" variant="secondary" icon={<FileSearch className="size-4" />}>Events</ActionButton>
            <ActionButton href="/admin/siem/findings" variant="secondary" icon={<ShieldAlert className="size-4" />}>Findings</ActionButton>
            <ActionButton href="/admin/siem/sources" variant="secondary" icon={<RadioTower className="size-4" />}>Sources</ActionButton>
          </>
        }
      />

      <SiemDashboard stats={data} />
    </main>
  );
}
