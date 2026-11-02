import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/session";
import { getNcmChangeHistoryAction } from "@/actions/ncm";
import { NcmChangeHistory } from "@/components/admin/ncm-change-history";
import PageHeader from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Riwayat Perubahan" };

export default async function NcmChangeHistoryPage() {
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");
  if (!session.activeSiteId) redirect("/select-site");

  const result = await getNcmChangeHistoryAction().catch((error) => ({
    status: "offline" as const,
    error: error instanceof Error ? error.message : String(error),
  }));

  const reviews = result.status === "online" && Array.isArray(result.reviews) ? result.reviews : [];

  return (
    <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        eyebrow="Admin / Network"
        title="Riwayat Perubahan"
        description="Jejak otomatis setiap perubahan konfigurasi switch dari backup NCM. Attestation berkala (ISO 27001 A.8.9) tetap ada di menu Config Review."
      />
      {result.status !== "online" && (
        <div className="rounded-lg border border-ops-warning/30 bg-ops-warning/10 p-3 text-sm text-ops-warning">
          {"message" in result ? result.message : `NCM tidak dapat dihubungi: ${result.error}`}
        </div>
      )}
      <NcmChangeHistory reviews={reviews as Record<string, unknown>[]} />
    </main>
  );
}
