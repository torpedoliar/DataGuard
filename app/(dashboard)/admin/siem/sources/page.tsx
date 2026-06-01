import { getSiemSources } from "@/actions/siem-sources";
import SiemSourceTable from "@/components/admin/siem-source-table";
import { verifySession } from "@/lib/session";
import { RadioTower } from "lucide-react";
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
          <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400">
            <RadioTower className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">SIEM Source Management</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Map syslog sources to active-site devices and parser profiles.</p>
          </div>
        </div>
        <Link href="/admin" className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Back to Admin
        </Link>
      </div>

      {"message" in data && data.message ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{data.message}</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-card-dark">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Known Syslog Sources</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Unmapped sources will not create incidents until linked to a device.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              {data.sources.length} Sources
            </span>
          </div>
          <SiemSourceTable sources={data.sources} devices={data.devices} />
        </div>
      )}
    </div>
  );
}
