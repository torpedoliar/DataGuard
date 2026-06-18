import { getCategories } from "@/actions/master-data";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Tag, Server } from "lucide-react";
import AddCategoryForm from "@/components/admin/add-category-form";
import CategoryTable from "@/components/admin/category-table";

export default async function CategoriesPage() {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

    const categories = await getCategories();

    return (
        <div className="px-4 py-6 sm:px-0">
            <div className="mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="size-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary">
                                <Tag className="h-6 w-6" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Category Management</h1>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    Manage device categories for organization.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Link
                            href="/admin"
                            className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                        >
                            <Server className="h-4 w-4" />
                            Manage Devices
                        </Link>
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-4">
                    <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500">
                            <Tag className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Total Categories</p>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">{categories.length}</p>
                        </div>
                    </div>
                </div>
            </div>

            <AddCategoryForm />

            <div className="mt-8">
                <h3 className="text-lg font-semibold mb-4 text-slate-800 dark:text-white">
                    Categories ({categories.length})
                </h3>
                <CategoryTable categories={categories} />
            </div>
        </div>
    );
}
