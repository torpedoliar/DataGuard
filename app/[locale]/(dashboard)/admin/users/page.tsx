import { getUsers } from "@/actions/users";
import { getSites } from "@/actions/sites";
import AddUserForm from "@/components/admin/add-user-form";
import UserTable from "@/components/admin/user-table";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Users, Server } from "lucide-react";

export default async function UsersPage() {
    const session = await verifySession();
    if (!session || session.role !== "superadmin") redirect("/checklist");

    const users = await getUsers();
    const sites = await getSites();

    return (
        <div className="px-4 py-6 lg:px-6">
            <div className="mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="size-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary">
                                <Users className="size-5" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-ops-text">User Management</h1>
                                <p className="text-sm text-ops-muted">
                                    Manage system users, roles, and permissions.
                                </p>
                            </div>
                        </div>
                    </div>
                    <Link
                        href="/admin"
                        className="flex items-center gap-2 px-4 py-2 bg-ops-surface-raised text-ops-muted rounded-lg hover:bg-ops-surface-sunken transition-colors"
                    >
                        <Server className="size-4" />
                        Manage Devices
                    </Link>
                </div>
            </div>

            <AddUserForm sites={sites} />

            <div className="mt-8">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-ops-text">
                        System Users ({users.length})
                    </h3>
                </div>
                <UserTable users={users} currentUserId={session.userId} sites={sites} />
            </div>
        </div>
    );
}
