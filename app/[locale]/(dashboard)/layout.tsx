
import AppShell from "@/components/ui/app-shell";
import { verifySession } from "@/lib/session";
import { getUserSites } from "@/lib/site-access";
import { getSettings } from "@/actions/settings";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Locale resolution for next-intl (server component).
    // Pages under (dashboard) live at /<locale>/... in the URL, so the first
    // segment of the path tells us which messages to load.
    const { getLocale } = await import("next-intl/server");
    const locale = await getLocale();
    if (routing.locales.includes(locale as (typeof routing.locales)[number])) {
        setRequestLocale(locale);
    }
    void (await getTranslations("Nav"));

    const session = await verifySession();
    if (!session) redirect("/login");

    // Get user's accessible sites for the site switcher
    const rawSites = await getUserSites(session.userId);
    const userSites = rawSites.map(s => ({ id: s.id, name: s.name, code: s.code || "" }));

    const appSettings = await getSettings();

    // Get the user's latest photoPath directly from the database
    const userDb = await db.query.users.findFirst({
        where: eq(users.id, session.userId),
        columns: { photoPath: true },
    });

    // Pastikan nama site yang aktif selalu up-to-date dari DB
    const currentSite = userSites.find(s => s.id === session.activeSiteId);
    const activeSiteName = currentSite ? currentSite.name : session.activeSiteName;

    return (
        <AppShell
            user={{ username: session.username, role: session.role, photoPath: userDb?.photoPath || null }}
            activeSite={{ id: session.activeSiteId, name: activeSiteName }}
            userSites={userSites}
            appSettings={{ appName: appSettings.appName, logoPath: appSettings.logoPath }}
        >
            {children}
        </AppShell>
    );
}
