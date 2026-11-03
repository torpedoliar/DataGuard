import { getSiemIocs } from "@/actions/siem-iocs";
import SiemIocsForm from "@/components/admin/siem-iocs-form";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function SiemIocsPage() {
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");
  if (!session.activeSiteId) redirect("/select-site");

  const data = await getSiemIocs();

  return (
    <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader eyebrow="Admin / SIEM" title="IOC watchlist" description="Indikator kompromi yang dicocokkan otomatis ke event oleh rule indicator_match." />
      {"message" in data && data.message ? (
        <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">{data.message}</div>
      ) : (
        <SiemIocsForm iocs={"iocs" in data ? data.iocs : []} />
      )}
    </main>
  );
}
