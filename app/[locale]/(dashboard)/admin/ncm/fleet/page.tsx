import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/session";
import { getFleetSnapshot } from "@/lib/ncm-fleet";
import NcmFleetDashboard from "@/components/admin/ncm-fleet-dashboard";
import PageHeader from "@/components/ui/page-header";

export const metadata: Metadata = { title: "NCM Fleet" };

// Live-fetch fleet page: every configured NCM is polled per render (no sync
// table per SPEC). A slow/unreachable site degrades to its own badge — the
// page must never 500 (getFleetSnapshot already degrades per-site; this
// catch covers DB-level failures).
export default async function NcmFleetPage() {
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

  const snapshot = await getFleetSnapshot().catch(() => ({
    sites: [],
    drifts: [],
    offlineCount: 0,
    openDriftTotal: 0,
    checkedAt: new Date().toISOString(),
  }));

  return (
    <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader
        eyebrow="Admin / NCM"
        title="NCM fleet"
        description="Status heartbeat dan review drift terbuka untuk semua site NCM dalam satu layar. Data diambil langsung dari tiap site saat halaman dibuka."
      />
      <NcmFleetDashboard snapshot={snapshot} />
    </main>
  );
}
