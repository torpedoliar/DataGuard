import { getEpdrThreats } from "@/actions/epdr-threats";
import { ConnectionGate, FreshnessWarning, SecurityStatusPills } from "@/components/admin/epdr/security-chrome";
import ThreatPanel from "@/components/admin/epdr/threat-panel";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

export const metadata = {
  title: "Threats | DataGuard",
};

export default async function EpdrThreatsPage() {
  const session = await verifySession();
  if (!session) redirect("/login");
  if (!session.activeSiteId) redirect("/select-site");
  const { getLocale } = await import("next-intl/server");
  const locale = await getLocale();
  setRequestLocale(locale);
  const t = await getTranslations("Epdr");

  const data = await getEpdrThreats();
  if ("message" in data) {
    return <main className="mx-auto max-w-3xl px-4 py-16 text-sm text-ops-muted">{data.message}</main>;
  }

  const hasData = data.connection !== "not_configured";

  return (
    <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader
        eyebrow={`Security / ${t("threats.title")}`}
        title={data.siteName || t("threats.title")}
        description={t("threats.description")}
        actions={<SecurityStatusPills context={data} locale={locale} />}
      />

      <ConnectionGate context={data} />
      {hasData && <FreshnessWarning context={data} locale={locale} />}
      {hasData && <ThreatPanel data={data} locale={locale} />}
    </main>
  );
}