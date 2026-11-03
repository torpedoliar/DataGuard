import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/session";
import { getNcmOverview } from "@/actions/ncm";
import { getDevices } from "@/actions/master-data";
import NcmDashboard from "@/components/admin/ncm-dashboard";
import PageHeader from "@/components/ui/page-header";

export const metadata: Metadata = { title: "NCM Management" };

export default async function NcmPage() {
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");
  if (!session.activeSiteId) redirect("/select-site");

  // Page-level degrade: a failed overview must render the offline banner,
  // never a 500 (getNcmOverview already catches NCM errors internally).
  const [overview, inventoryDevices] = await Promise.all([
    getNcmOverview().catch(() => ({
      status: "offline" as const,
      url: null,
      lastSeenAt: null,
      error: "Gagal memuat status NCM.",
    })),
    getDevices().catch(() => []),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader
        eyebrow="Admin / NCM"
        title="NCM overview"
        description="Kelola switch, backup terjadwal, baseline golden, dan review drift dari aplikasi NCM site aktif. Semua aksi tercatat di audit log; kredensial tidak pernah ditampilkan kembali."
      />
      <NcmDashboard
        overview={overview}
        inventoryDevices={inventoryDevices}
        isSuperadmin={session.role === "superadmin"}
      />
    </main>
  );
}
