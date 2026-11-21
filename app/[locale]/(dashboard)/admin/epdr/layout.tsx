import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/session";
import { requireSiteAccess } from "@/lib/site-access";
import { loadEpdrDisplayTimeZone } from "@/lib/epdr/display-time-zone";
import { EpdrTimeZoneProvider } from "@/components/admin/epdr/time-zone-provider";
import { TimeZoneSelector } from "@/components/admin/epdr/time-zone-selector";

export default async function EpdrLayout({ children }: { children: ReactNode }) {
  const session = await verifySession();
  if (!session) redirect("/login");
  if (!session.activeSiteId) redirect("/select-site");
  if (!await requireSiteAccess(session.activeSiteId)) redirect("/select-site");
  const zone = await loadEpdrDisplayTimeZone(session.userId, session.activeSiteId);
  return <EpdrTimeZoneProvider key={session.activeSiteId} initialTimeZone={zone.personalTimeZone} siteTimeZone={zone.siteTimeZone}>
    <div className="mx-auto flex w-full max-w-[1600px] justify-end px-4 pt-4 lg:px-8">
      <TimeZoneSelector />
    </div>
    {children}
  </EpdrTimeZoneProvider>;
}
