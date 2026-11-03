import { getBrands } from "@/actions/brands";
import AddBrandForm from "@/components/admin/add-brand-form";
import BrandTable from "@/components/admin/brand-table";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Tag, ArrowLeft } from "lucide-react";

export default async function BrandsPage() {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

    const brands = await getBrands();

    return (
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="size-10 rounded-lg bg-ops-info-soft flex items-center justify-center text-ops-info">
                        <Tag className="size-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-ops-text">Brand Management</h1>
                        <p className="text-sm text-ops-muted">
                            Manage hardware brands and their logos
                        </p>
                    </div>
                </div>
                <Link
                    href="/admin"
                    className="text-sm font-medium text-ops-info hover:text-ops-info flex items-center gap-1"
                >
                    <ArrowLeft className="size-[18px]" />
                    Back to Admin
                </Link>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1">
                    <AddBrandForm />
                </div>
                <div className="lg:col-span-2">
                    <div className="bg-ops-surface rounded-lg shadow-sm border border-ops-border overflow-hidden">
                        <div className="px-6 py-4 border-b border-ops-border flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-ops-text">Brand List</h3>
                            <span className="bg-ops-surface-raised text-ops-muted py-1 px-3 rounded-full text-xs font-medium">
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
