import { getSiteLayout, getRackStats, getRoomSettings } from "@/actions/rack-layout";
import RackLayoutShell from "@/components/admin/rack-layout-shell";
import PageHeader from "@/components/ui/page-header";
import ActionButton from "@/components/ui/action-button";
import { verifySession } from "@/lib/session";
import { hasAdminAccess } from "@/lib/site-access";
import { redirect } from "next/navigation";
import { Network, PieChart, Server } from "lucide-react";
import { OfflineBanner } from "@/components/mobile/offline-banner";
import { BottomNav } from "@/components/mobile/bottom-nav";

export default async function RackPage({ searchParams }: { searchParams: Promise<{ deviceId?: string }> }) {
    const query = await searchParams;
    const initialDeviceId = query.deviceId && /^[1-9]\d*$/.test(query.deviceId) && Number.isSafeInteger(Number(query.deviceId)) ? Number(query.deviceId) : null;
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

    const { racks, facilities } = await getSiteLayout();
    const stats = await getRackStats();
    const rooms = await getRoomSettings();
    const canEditAppearance = await hasAdminAccess();
    const { getCategories } = await import("@/actions/master-data");
    const categories = await getCategories();

    const kpis: { label: string; value: number; icon: typeof Server; tone: "info" | "success" | "accent" }[] = stats ? [
        { label: "Total devices", value: stats.totalDevices, icon: Server, tone: "info" },
        { label: "In rack positions", value: stats.devicesWithRack, icon: Network, tone: "success" },
        { label: "Zones", value: stats.devicesByZone.length, icon: PieChart, tone: "accent" },
    ] : [];
    const toneClass: Record<"info" | "success" | "accent", string> = {
        info: "bg-ops-info-soft text-ops-info",
        success: "bg-ops-success-soft text-ops-success",
        accent: "bg-ops-accent-soft text-ops-accent",
    };

    return (
        <>
        <OfflineBanner />
        <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 pb-20 lg:px-8">
            <PageHeader
                eyebrow="Admin / Infrastructure"
                title="Rack layout"
                description={session.activeSiteName ? `Visual overview of device positions in ${session.activeSiteName}.` : "Visual overview of device positions in racks."}
                actions={
                    <ActionButton href="/admin" variant="secondary" icon={<Server className="size-4" />}>
                        Manage devices
                    </ActionButton>
                }
            />

            {/* KPI cards */}
            {kpis.length > 0 && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {kpis.map((kpi) => {
                        const Icon = kpi.icon;
                        return (
                            <div key={kpi.label} className="ops-panel flex items-center gap-3 p-4">
                                <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${toneClass[kpi.tone]}`}>
                                    <Icon className="size-5" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[13px] text-ops-muted">{kpi.label}</p>
                                    <p className="text-2xl font-semibold tabular-nums leading-tight text-ops-text">{kpi.value}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Rack layout visualization */}
            <RackLayoutShell initialDeviceId={initialDeviceId} facilities={facilities} racks={racks} categories={categories} rooms={rooms} canEditAppearance={canEditAppearance} siteName={session.activeSiteName ?? ""} />
        </main>
        <BottomNav />
        </>
    );
}
