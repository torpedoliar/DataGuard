import { getEpdrThreats } from "@/actions/epdr-threats";
import type { ThreatQuery } from "@/lib/epdr/threat-query";
import { ConnectionGate, FreshnessWarning, SecurityStatusPills } from "@/components/admin/epdr/security-chrome";
import ThreatPanel from "@/components/admin/epdr/threat-panel";
import ProviderTargets from "@/components/admin/epdr/provider-targets";
import EpdrNav from "@/components/admin/epdr/epdr-nav";
import SyncRefresh from "@/components/admin/epdr/sync-refresh";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

export const metadata = {
  title: "Threats | DataGuard",
};

export default async function EpdrThreatsPage({ searchParams }: {
  searchParams: Promise<{ scoreMode?: string | string[]; minScore?: string | string[]; maxScore?: string | string[]; sort?: string | string[] }>;
}) {
  const session = await verifySession();
  if (!session) redirect("/login");
  if (!session.activeSiteId) redirect("/select-site");
  const { getLocale } = await import("next-intl/server");
  const locale = await getLocale();
  setRequestLocale(locale);
  const t = await getTranslations("Epdr");
  const params = await searchParams;
  const single = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;
  const bounded = (value: string | string[] | undefined) => {
    const parsed = Number(single(value));
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 10 ? parsed : undefined;
  };
  // Dashboard queue links may preselect a bounded score/sort view. Unknown
  // values are ignored; nothing here is trusted as a site or limit parameter.
  const scoreMode = single(params.scoreMode);
  const sort = single(params.sort);
  const initialQuery: Partial<Pick<ThreatQuery, "scoreMode" | "minScore" | "maxScore" | "sort">> = {};
  if (scoreMode === "range" || scoreMode === "missing" || scoreMode === "any") initialQuery.scoreMode = scoreMode;
  const minScore = bounded(params.minScore);
  const maxScore = bounded(params.maxScore);
  if (minScore !== undefined) initialQuery.minScore = minScore;
  if (maxScore !== undefined) initialQuery.maxScore = maxScore;
  if (sort === "newest" || sort === "oldest" || sort === "scoreHigh") initialQuery.sort = sort;

  const data = await getEpdrThreats();
  if ("message" in data) {
    return <main className="mx-auto max-w-3xl px-4 py-16 text-sm text-ops-muted">{data.message}</main>;
  }

  const hasData = data.connection !== "not_configured";

  return (
    <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={data.siteName || t("threats.title")}
        description={t("threats.description")}
        actions={<SecurityStatusPills context={data} locale={locale} />}
      />

      <EpdrNav isAdmin={data.isAdmin} />
      <ConnectionGate context={data} />
      <FreshnessWarning context={data} locale={locale} />
      {(data.connection === "syncing_first" || data.connection === "error" || data.connection === "stale") && (
        <SyncRefresh key={data.siteName} waiting={data.connection === "syncing_first"} />
      )}
      {hasData && <ThreatPanel data={data} locale={locale}
        initialQuery={Object.keys(initialQuery).length ? initialQuery : undefined} />}
      {hasData && <ProviderTargets isAdmin={data.isAdmin} />}
    </main>
  );
}