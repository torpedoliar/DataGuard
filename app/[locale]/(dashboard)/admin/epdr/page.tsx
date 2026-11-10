import { getEpdrEndpoints } from "@/actions/epdr-endpoints";
import { linkEpdrEndpointToAsset, setEpdrEndpointCritical, setEpdrEndpointNoAuto, unlinkEpdrEndpoint } from "@/actions/epdr-endpoints";
import ActionButton from "@/components/ui/action-button";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

const STATUS_LABEL: Record<number, { label: string; cls: string }> = {
  1: { label: "Protected", cls: "text-ops-success" },
  2: { label: "Disabled", cls: "text-ops-warning" },
  3: { label: "Error", cls: "text-ops-danger" },
  4: { label: "Install error", cls: "text-ops-danger" },
  5: { label: "No license", cls: "text-ops-muted" },
};

/** Plain `<form action>` server actions must return void; our useActionState
 * actions return a state object that Next ignores here (state is shown via
 * revalidatePath refresh). */
function asFormAction(action: (formData: FormData) => Promise<unknown>): (formData: FormData) => Promise<void> {
  return action as unknown as (formData: FormData) => Promise<void>;
}

function statusLabel(status: number | null) {
  if (status === null) return { label: "Unknown", cls: "text-ops-muted" };
  return STATUS_LABEL[status] ?? { label: `Unknown (${status})`, cls: "text-ops-muted" };
}

function card(label: string, value: number, tone: string) {
  return (
    <div className="ops-panel p-4">
      <div className="text-[12px] uppercase tracking-wide text-ops-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

export default async function EpdrEndpointsPage() {
  const session = await verifySession();
  if (!session) redirect("/login");
  if (!session.activeSiteId) redirect("/select-site");
  const { getLocale } = await import("next-intl/server");
  setRequestLocale(await getLocale());

  const data = await getEpdrEndpoints();
  if ("message" in data) {
    return <main className="mx-auto max-w-6xl px-4 py-10 text-ops-muted">{data.message}</main>;
  }

  const s = data.summary;

  return (
    <main className="mx-auto flex w-full max-w-[1500px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader eyebrow="Security / Endpoint Security" title="Endpoint Security" description="Monitor proteksi WatchGuard EPDR per endpoint." />

      {s.stale && (
        <div className="rounded-md border border-ops-warning/25 bg-ops-warning-soft px-3 py-2.5 text-[13px] text-ops-warning">
          Data mungkin kedaluwarsa — sinkronisasi terakhir {s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString() : "belum pernah"}.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        {card("Total", s.total, "text-ops-text")}
        {card("Protected", s.protected, "text-ops-success")}
        {card("Disabled", s.disabled, "text-ops-warning")}
        {card("Error", s.error, "text-ops-danger")}
        {card("Install error", s.installError, "text-ops-danger")}
        {card("No license", s.noLicense, "text-ops-muted")}
        {card("Unknown", s.unknown, "text-ops-subtle")}
      </div>

      <div className="ops-panel overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-ops-border text-ops-muted">
            <tr>
              <th className="px-3 py-2">Host</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2">Tipe</th>
              <th className="px-3 py-2">Group</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Aset</th>
              <th className="px-3 py-2">Critical</th>
              <th className="px-3 py-2">No auto</th>
              <th className="px-3 py-2">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {data.endpoints.map((e) => {
              const st = statusLabel(e.accumulatedProtectionStatus);
              return (
                <tr key={e.id} className="border-b border-ops-border/50">
                  <td className="px-3 py-2 font-medium text-ops-text">{e.hostName}</td>
                  <td className="px-3 py-2 text-ops-muted">{e.ipAddress ?? "—"}</td>
                  <td className="px-3 py-2 text-ops-muted">{e.deviceType ?? "—"}</td>
                  <td className="px-3 py-2 text-ops-muted">{e.groupPath ?? "—"}</td>
                  <td className={`px-3 py-2 font-medium ${st.cls}`}>{st.label}</td>
                  <td className="px-3 py-2 text-ops-muted">{e.deviceId ? `#${e.deviceId}` : "Tidak terpetakan"}</td>
                  <td className="px-3 py-2 text-ops-muted">{e.isCritical ? "Ya" : "—"}</td>
                  <td className="px-3 py-2 text-ops-muted">{e.noAuto ? "Ya" : "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <form action={asFormAction(setEpdrEndpointCritical.bind(null, undefined))}>
                        <input type="hidden" name="endpointId" value={e.id} />
                        <input type="hidden" name="value" value={String(!e.isCritical)} />
                        <ActionButton variant="secondary">{e.isCritical ? "Lepas critical" : "Critical"}</ActionButton>
                      </form>
                      <form action={asFormAction(setEpdrEndpointNoAuto.bind(null, undefined))}>
                        <input type="hidden" name="endpointId" value={e.id} />
                        <input type="hidden" name="value" value={String(!e.noAuto)} />
                        <ActionButton variant="secondary">{e.noAuto ? "Izinkan auto" : "Blokir auto"}</ActionButton>
                      </form>
                      {e.deviceId ? (
                        <form action={asFormAction(unlinkEpdrEndpoint.bind(null, undefined))}>
                          <input type="hidden" name="endpointId" value={e.id} />
                          <ActionButton variant="secondary">Lepas aset</ActionButton>
                        </form>
                      ) : (
                        <form action={asFormAction(linkEpdrEndpointToAsset.bind(null, undefined))} className="flex gap-1">
                          <input type="hidden" name="endpointId" value={e.id} />
                          <input type="number" name="deviceId" placeholder="ID aset" className="ops-input h-8 w-20 px-2 text-xs" />
                          <ActionButton variant="secondary">Tautkan</ActionButton>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}