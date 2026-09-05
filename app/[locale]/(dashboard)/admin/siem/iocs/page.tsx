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
    <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader eyebrow="Admin / SIEM" title="IOC Watchlist" description="Indikator kompromi yang dicocokkan otomatis ke event oleh rule indicator_match." />
      {"message" in data && data.message ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{data.message}</div>
      ) : (
        <SiemIocsForm iocs={"iocs" in data ? data.iocs : []} />
      )}
    </main>
  );
}
