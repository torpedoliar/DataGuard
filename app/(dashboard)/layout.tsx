
import Navbar from "@/components/ui/navbar";
import { verifySession } from "@/lib/session";
import { getUserSites } from "@/lib/site-access";
import { getSettings } from "@/actions/settings";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await verifySession();
    if (!session) redirect("/login");

    // Get user's accessible sites for the site switcher
    const rawSites = await getUserSites(session.userId);
    const userSites = rawSites.map(s => ({ id: s.id, name: s.name, code: s.code || "" }));

    const appSettings = await getSettings();

    // Pastikan nama site yang aktif selalu up-to-date dari DB
    const currentSite = userSites.find(s => s.id === session.activeSiteId);
    const activeSiteName = currentSite ? currentSite.name : session.activeSiteName;

    return (
        <div className="min-h-screen bg-[#0b1120] font-display" suppressHydrationWarning>
            <Navbar
                user={{ username: session.username, role: session.role }}
                activeSite={{ id: session.activeSiteId, name: activeSiteName }}
                userSites={userSites}
                appSettings={{ appName: appSettings.appName, logoPath: appSettings.logoPath }}
            />
            {children}
        </div>
    );
}
