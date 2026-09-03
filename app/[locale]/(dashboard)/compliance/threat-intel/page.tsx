import { getThreatIntelligences } from "@/actions/threat-intel";
import { getDevices } from "@/actions/master-data";
import ThreatIntelClient from "@/components/compliance/threat-intel-client";
import { db } from "@/db";
import { sites } from "@/db/schema";
import { verifySession } from "@/lib/session";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

export const metadata = {
  title: "Threat Intelligence | ISO 27001 Compliance",
  description: "Threat intelligence and technical vulnerability management aligned with ISO/IEC 27001:2022 A.5.7 & A.8.8",
};

export default async function ThreatIntelPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const session = await verifySession();
  if (!session) redirect("/login");
  if (session.role !== "admin" && session.role !== "superadmin") {
    redirect("/");
  }

  const { locale } = await params;
  setRequestLocale(locale);

  let siteName = "All Sites";
  if (session.activeSiteId) {
    const [site] = await db
      .select({ name: sites.name })
      .from(sites)
      .where(eq(sites.id, session.activeSiteId));
    if (site) siteName = site.name;
  }

  // Load initial data
  const [dataResult, rawDevices] = await Promise.all([
    getThreatIntelligences({ siteId: session.activeSiteId ?? undefined }),
    getDevices(),
  ]);

  const deviceOptions = (rawDevices || []).map((d) => ({
    id: d.id,
    name: d.name,
    assetCode: d.assetCode,
  }));

  return (
    <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-4 py-6 lg:px-8">
      <ThreatIntelClient
        initialData={dataResult.success ? dataResult.items : []}
        initialStats={dataResult.stats}
        currentSiteId={session.activeSiteId ?? null}
        currentSiteName={siteName}
        devices={deviceOptions}
      />
    </main>
  );
}
