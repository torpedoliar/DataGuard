import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { sites, userSites, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import MapSelector from "@/components/ui/map-selector";
import { getSettings } from "@/actions/settings";
import { MapPinOff } from "lucide-react";

export default async function SelectSitePage() {
    const session = await verifySession();
    if (!session) redirect("/login");

    // Fetch sites accessible to this user (with coordinates)
    let availableSites;

    if (session.role === "superadmin") {
        // Superadmin sees all active sites
        availableSites = await db.select().from(sites).where(eq(sites.isActive, true));
    } else {
        // Regular users see only their assigned sites
        availableSites = await db
            .select({
                id: sites.id,
                name: sites.name,
                code: sites.code,
                address: sites.address,
                latitude: sites.latitude,
                longitude: sites.longitude,
                isActive: sites.isActive,
            })
            .from(userSites)
            .innerJoin(sites, eq(userSites.siteId, sites.id))
            .where(
                and(
                    eq(userSites.userId, session.userId),
                    eq(sites.isActive, true)
                )
            );
    }

    // N50: if the session landed here without a pre-selected site, but the
    // user only has 1 site to choose from, jump straight to /checklist.
    if (!session.activeSiteId) {
        const isStaffWithSingleSite =
            session.role !== "superadmin" && availableSites.length === 1;
        if (isStaffWithSingleSite) {
            const { switchSite } = await import("@/actions/auth");
            await switchSite(availableSites[0].id);
            redirect("/checklist");
        }
    }

    // N50: pre-select the user's defaultSiteId on the map when present and
    // accessible. Falls back to "no selection" so they have to click.
    let defaultSelectedId: number | null = null;
    if (!session.activeSiteId) {
        const me = await db.query.users.findFirst({
            where: eq(users.id, session.userId),
        });
        const userDefault = me?.defaultSiteId ?? null;
        if (
            userDefault &&
            availableSites.some((s) => s.id === userDefault)
        ) {
            defaultSelectedId = userDefault;
        } else if (availableSites.length === 1) {
            defaultSelectedId = availableSites[0].id;
        }
    }

    // Filter sites that have coordinates
    const sitesWithCoords = availableSites
        .filter((s) => s.latitude && s.longitude)
        .map((s) => ({
            id: s.id,
            name: s.name,
            code: s.code,
            address: s.address || null,
            latitude: parseFloat(s.latitude!),
            longitude: parseFloat(s.longitude!),
        }));

    // Sites without coordinates (fallback list)
    const sitesWithoutCoords = availableSites.filter(
        (s) => !s.latitude || !s.longitude
    );

    const appSettings = await getSettings();

    return (
        <div className="relative">
            <MapSelector
                sites={sitesWithCoords}
                username={session.username}
                appName={appSettings.appName}
                defaultSelectedId={defaultSelectedId}
            />

            {sitesWithoutCoords.length > 0 && (
                <div className="fixed inset-x-4 bottom-4 z-50 md:left-auto md:w-96">
                    <div className="rounded-md border border-ops-border bg-ops-surface-raised p-4 shadow-2xl">
                        <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-amber-200">
                            <MapPinOff className="size-4" />
                            Sites without map coordinates
                        </p>
                        <div className="space-y-1.5">
                            {sitesWithoutCoords.map((site) => (
                                <form key={site.id} action={async () => {
                                    "use server";
                                    const { switchSite } = await import("@/actions/auth");
                                    await switchSite(site.id);
                                    redirect("/checklist");
                                }}>
                                    <button
                                        type="submit"
                                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-300 transition-colors hover:bg-ops-surface"
                                    >
                                        <span className="size-2 rounded-full bg-amber-400" />
                                        <span>{site.name}</span>
                                        <span className="ml-auto font-mono text-[10px] text-ops-muted">{site.code}</span>
                                    </button>
                                </form>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
