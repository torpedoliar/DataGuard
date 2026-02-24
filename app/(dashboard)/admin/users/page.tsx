import { getUsers } from "@/actions/users";
import AddUserForm from "@/components/admin/add-user-form";
import UserTable from "@/components/admin/user-table";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function UsersPage() {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

    const users = await getUsers();

    return (
        <div className="px-4 py-6 sm:px-0">
            <div className="mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="size-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary">
                                <span className="material-symbols-outlined">group</span>
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">User Management</h1>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    Manage system users, roles, and permissions.
                                </p>
                            </div>
                        </div>
                    </div>
                    <Link
                        href="/admin"
                        className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                    >
                        <span className="material-symbols-outlined text-sm">dns</span>
                        Manage Devices
                    </Link>
                </div>
            </div>

            <AddUserForm />

            <div className="mt-8">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-white">
                        System Users ({users.length})
                    </h3>
                </div>
                <UserTable users={users} currentUserId={session.userId} />
            </div>
        </div>
    );
}
