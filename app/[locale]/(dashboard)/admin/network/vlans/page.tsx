import { getVlans } from "@/actions/network";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { Network, Server } from "lucide-react";
import AddVlanForm from "@/components/admin/add-vlan-form";
import VlanTable from "@/components/admin/vlan-table";
import ActionButton from "@/components/ui/action-button";
import PageHeader from "@/components/ui/page-header";

export default async function VlansPage() {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

    const vlans = await getVlans();

    return (
        <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
            <PageHeader
                eyebrow="Admin / Network"
                title="VLAN management"
                description="Manage Virtual LAN segments, subnets, and scopes."
                actions={
                    <ActionButton href="/admin" variant="secondary" icon={<Server className="size-4" />}>
                        Device management
                    </ActionButton>
                }
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="ops-panel flex items-center gap-3 p-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ops-info-soft text-ops-info">
                        <Network className="size-5" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[13px] text-ops-muted">Total provisioned VLANs</p>
                        <p className="text-2xl font-semibold tabular-nums leading-tight text-ops-text">{vlans.length}</p>
                    </div>
                </div>
            </div>

            <AddVlanForm />

            <section className="flex flex-col gap-4">
                <div className="flex items-end justify-between gap-3">
                    <div>
                        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">VLAN definitions</h2>
                        <p className="mt-0.5 text-[13px] text-ops-muted">Segments available to access and trunk ports.</p>
                    </div>
                    <span className="shrink-0 text-[13px] tabular-nums text-ops-muted">{vlans.length} total</span>
                </div>
                <VlanTable vlans={vlans} />
            </section>
        </main>
    );
}
