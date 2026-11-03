import { getBrands } from "@/actions/brands";
import AddBrandForm from "@/components/admin/add-brand-form";
import BrandTable from "@/components/admin/brand-table";
import ActionButton from "@/components/ui/action-button";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export default async function BrandsPage() {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

    const brands = await getBrands();

    return (
        <div className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
            <PageHeader
                eyebrow="Admin / Brands"
                title="Brand management"
                description="Manage hardware brands and their logos."
                actions={
                    <ActionButton href="/admin" variant="secondary" icon={<ArrowLeft aria-hidden="true" />}>
                        Back to admin
                    </ActionButton>
                }
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="lg:col-span-1">
                    <AddBrandForm />
                </div>
                <div className="flex min-w-0 flex-col gap-3 lg:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Brand list</h2>
                        <span className="rounded-full bg-ops-surface-raised px-2.5 py-1 text-xs font-medium tabular-nums text-ops-muted">
                            {brands.length} brands
                        </span>
                    </div>
                    <BrandTable brands={brands} />
                </div>
            </div>
        </div>
    );
}
