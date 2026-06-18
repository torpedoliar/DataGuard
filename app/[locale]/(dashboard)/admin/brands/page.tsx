import { getBrands } from "@/actions/brands";
import AddBrandForm from "@/components/admin/add-brand-form";
import BrandTable from "@/components/admin/brand-table";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Tag } from "lucide-react";

export default async function BrandsPage() {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

    const brands = await getBrands();

    return (
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="size-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-500">
                        <span className="material-symbols-outlined text-2xl">local_offer</span>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Brand Management</h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            Manage hardware brands and their logos
                        </p>
                    </div>
                </div>
                <Link
                    href="/admin"
                    className="text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1"
                >
                    <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                    Back to Admin
                </Link>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1">
                    <AddBrandForm />
                </div>
                <div className="lg:col-span-2">
                    <div className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Brand List</h3>
                            <span className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 py-1 px-3 rounded-full text-xs font-medium">
                                {brands.length} Brands
                            </span>
                        </div>
                        <BrandTable brands={brands} />
                    </div>
                </div>
            </div>
        </div>
    );
}
