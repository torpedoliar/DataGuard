import { getCategories } from "@/actions/master-data";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { Tag, Server } from "lucide-react";
import AddCategoryForm from "@/components/admin/add-category-form";
import CategoryTable from "@/components/admin/category-table";
import ActionButton from "@/components/ui/action-button";
import PageHeader from "@/components/ui/page-header";
import StatsCard from "@/components/ui/stats-card";

export default async function CategoriesPage() {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

    const categories = await getCategories();

    return (
        <div className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
            <PageHeader
                eyebrow="Admin / Categories"
                title="Category management"
                description="Manage device categories for organization."
                actions={
                    <ActionButton href="/admin" variant="secondary" icon={<Server aria-hidden="true" />}>
                        Manage devices
                    </ActionButton>
                }
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <StatsCard
                    label="Total categories"
                    value={categories.length}
                    tone="info"
                    icon={<Tag aria-hidden="true" className="size-5" />}
                />
            </div>

            <AddCategoryForm />

            <section className="flex flex-col gap-3">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                    Categories <span className="tabular-nums text-ops-muted">({categories.length})</span>
                </h2>
                <CategoryTable categories={categories} />
            </section>
        </div>
    );
}
