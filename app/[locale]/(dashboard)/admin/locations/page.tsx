import { getLocations } from "@/actions/locations";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { MapPin, Server } from "lucide-react";
import AddLocationForm from "@/components/admin/add-location-form";
import LocationTable from "@/components/admin/location-table";
import ActionButton from "@/components/ui/action-button";
import PageHeader from "@/components/ui/page-header";
import StatsCard from "@/components/ui/stats-card";
import { hasAdminAccess } from "@/lib/site-access";

export default async function LocationsPage() {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

    const locations = await getLocations();
    const canEditLayout = await hasAdminAccess();

    return (
        <div className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
            <PageHeader
                eyebrow="Admin / Locations"
                title="Location management"
                description="Manage data center rooms, zones, or specific areas for equipment mapping."
                actions={
                    <ActionButton href="/admin" variant="secondary" icon={<Server aria-hidden="true" />}>
                        Manage devices
                    </ActionButton>
                }
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <StatsCard
                    label="Total locations"
                    value={locations.length}
                    tone="success"
                    icon={<MapPin aria-hidden="true" className="size-5" />}
                />
            </div>

            <AddLocationForm />

            <section className="flex flex-col gap-3">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Locations list</h2>
                <LocationTable locations={locations} canEditLayout={canEditLayout} />
            </section>
        </div>
    );
}
