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
        <div className="px-4 py-6 lg:px-6">
            <div className="mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="size-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary">
                                <Tag className="h-6 w-6" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-ops-text">Category Management</h1>
                                <p className="text-sm text-ops-muted">
                                    Manage device categories for organization.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Link
                            href="/admin"
                            className="flex items-center gap-2 px-4 py-2 bg-ops-surface-raised text-ops-muted rounded-lg hover:bg-ops-surface-sunken transition-colors"
                        >
                            <Server className="h-4 w-4" />
                            Manage Devices
                        </Link>
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="bg-ops-surface rounded-lg shadow-sm border border-ops-border p-4">
                    <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-ops-info-soft flex items-center justify-center text-ops-info">
                            <Tag className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-sm text-ops-muted">Total Categories</p>
                            <p className="text-2xl font-bold text-ops-text">{categories.length}</p>
                        </div>
                    </div>
                </div>
            </div>

            <AddCategoryForm />

            <div className="mt-8">
                <h3 className="text-lg font-semibold mb-4 text-ops-text">
                    Categories ({categories.length})
                </h3>
                <CategoryTable categories={categories} />
            </div>
        </div>
    );
}
