
import Navbar from "@/components/ui/navbar";
import { verifySession } from "@/lib/session";
import { getUserSites } from "@/lib/site-access";
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

    return (
        <div className="min-h-screen bg-[#0b1120] font-display" suppressHydrationWarning>
            <Navbar
                user={{ username: session.username, role: session.role }}
                activeSite={{ id: session.activeSiteId, name: session.activeSiteName }}
                userSites={userSites}
            />
            {children}
        </div>
    );
}
