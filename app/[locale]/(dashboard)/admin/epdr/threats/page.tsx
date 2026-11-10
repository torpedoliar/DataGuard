import { getEpdrDetections } from "@/actions/epdr-threats";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import Link from "next/link";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

export default async function EpdrThreatsPage() {
  const session = await verifySession();
  if (!session) redirect("/login");
  if (!session.activeSiteId) redirect("/select-site");
  const { getLocale } = await import("next-intl/server");
  setRequestLocale(await getLocale());

  const data = await getEpdrDetections();
  if ("message" in data) {
    return <main className="mx-auto max-w-6xl px-4 py-10 text-ops-muted">{data.message}</main>;
  }

  return (
    <main className="mx-auto flex w-full max-w-[1500px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader eyebrow="Security / Threats" title="Threats" description="Deteksi aktivitas WatchGuard EPDR dan insiden ThreatSync." />

      <div className="ops-panel overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-ops-border text-ops-muted">
            <tr>
              <th className="px-3 py-2">Deteksi</th>
              <th className="px-3 py-2">Sumber</th>
              <th className="px-3 py-2">Kategori</th>
              <th className="px-3 py-2">Skor</th>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2">Endpoint</th>
              <th className="px-3 py-2">Incident</th>
            </tr>
          </thead>
          <tbody>
            {data.detections.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-ops-muted">Belum ada deteksi.</td>
              </tr>
            ) : (
              data.detections.map((d) => (
                <tr key={d.id} className="border-b border-ops-border/50">
                  <td className="px-3 py-2 font-medium text-ops-text">{d.threatName ?? `#${d.id}`}</td>
                  <td className="px-3 py-2 text-ops-muted">{d.source}</td>
                  <td className="px-3 py-2 text-ops-muted">{d.category}</td>
                  <td className="px-3 py-2 text-ops-muted">{d.threatScore ?? "—"}</td>
                  <td className="px-3 py-2 text-ops-muted">{d.severity}</td>
                  <td className="px-3 py-2 text-ops-muted">{d.endpointId ? `#${d.endpointId}` : "—"}</td>
                  <td className="px-3 py-2">
                    {d.incidentId ? <Link href={`/admin/incidents/${d.incidentId}`} className="text-ops-accent">#{d.incidentId}</Link> : <span className="text-ops-subtle">—</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}