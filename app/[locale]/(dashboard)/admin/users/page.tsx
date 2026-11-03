import { getUsers } from "@/actions/users";
import { getSites } from "@/actions/sites";
import AddUserForm from "@/components/admin/add-user-form";
import UserTable from "@/components/admin/user-table";
import ActionButton from "@/components/ui/action-button";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { Server } from "lucide-react";

export default async function UsersPage() {
    const session = await verifySession();
    if (!session || session.role !== "superadmin") redirect("/checklist");

    const users = await getUsers();
    const sites = await getSites();

    return (
        <div className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
            <PageHeader
                eyebrow="Admin / Users"
                title="User management"
                description="Manage system users, roles, and permissions."
                actions={
                    <ActionButton href="/admin" variant="secondary" icon={<Server aria-hidden="true" />}>
                        Manage devices
                    </ActionButton>
                }
            />

            <AddUserForm sites={sites} />

            <section className="flex flex-col gap-3">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                    System users <span className="tabular-nums text-ops-muted">({users.length})</span>
                </h2>
                <UserTable users={users} currentUserId={session.userId} sites={sites} />
            </section>
        </div>
    );
}
