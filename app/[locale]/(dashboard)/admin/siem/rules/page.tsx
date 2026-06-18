import { getSiemRules } from "@/actions/siem-settings";
import SiemRulesForm, { type SiemRuleRow } from "@/components/admin/siem-rules-form";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function SiemRulesPage() {
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");
  if (!session.activeSiteId) redirect("/select-site");

  const data = await getSiemRules();

  if ("message" in data) {
    return (
      <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-4 py-5 lg:px-6">
        <PageHeader eyebrow="Admin / SIEM" title="SIEM Rules" description="Atur rule mana yang aktif dan mana yang mengirim alert ke Telegram." />
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{data.message}</div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader eyebrow="Admin / SIEM" title="SIEM Rules" description="Atur rule mana yang aktif dan mana yang mengirim alert ke Telegram." />
      <SiemRulesForm rules={data.rules as SiemRuleRow[]} alertMinSeverity={data.alertMinSeverity} />
    </main>
  );
}
