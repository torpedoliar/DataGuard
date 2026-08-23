import { redirect } from "next/navigation";
import { verifySession } from "@/lib/session";
import NetworkDocsButton from "@/components/admin/network-docs-button";
import PageHeader from "@/components/ui/page-header";
import { OfflineBanner } from "@/components/mobile/offline-banner";
import { BottomNav } from "@/components/mobile/bottom-nav";

export default async function NetworkDocsPage() {
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");
  if (!session.activeSiteId) redirect("/select-site");

  return (
    <>
      <OfflineBanner />
      <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-4 py-5 lg:px-6 pb-20">
        <PageHeader
          eyebrow="Admin / Network"
          title="Network Docs"
          description="Sinkronkan perangkat switch, tabel VLAN, dan konfigurasi port dari aplikasi Dokumentasi Jaringan (network-doc API). Switch dicocokkan dengan device berdasarkan IP, lalu nama. Field yang tidak tersedia di API (cabling, MAC, speed) tidak disentuh. Catatan: jumlah port faceplate mengikuti dokumen — layout yang diatur manual di halaman Network device akan ditimpa saat sinkron."
        />
        <NetworkDocsButton />
      </main>
      <BottomNav />
    </>
  );
}
