import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { sites, userSites } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import MapSelector from "@/components/ui/map-selector";
import { getSettings } from "@/actions/settings";

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
            />

            {/* Fallback list for sites without coordinates */}
            {sitesWithoutCoords.length > 0 && (
                <div className="fixed top-4 right-4 z-50">
                    <div className="bg-slate-800/90 backdrop-blur-xl border border-slate-700/50 rounded-xl p-4 shadow-2xl max-w-xs">
                        <p className="text-xs text-amber-400 font-semibold mb-2 flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[14px]">warning</span>
                            Sites tanpa koordinat:
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
                                        className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700/50 rounded-lg transition-colors flex items-center gap-2"
                                    >
                                        <span className="size-2 rounded-full bg-amber-400" />
                                        <span>{site.name}</span>
                                        <span className="text-[10px] font-mono text-slate-500 ml-auto">{site.code}</span>
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
