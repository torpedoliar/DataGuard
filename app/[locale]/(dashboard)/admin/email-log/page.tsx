import { getEmailAlerts } from "@/actions/email-log";
import EmailLogClient from "@/components/admin/email-log-client";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { Mail } from "lucide-react";

export const metadata = {
    title: "Email Log | DataGuard"
};

export default async function EmailLogPage({
    searchParams,
}: {
    searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) {
        redirect("/checklist");
    }

    const params = await searchParams;
    const page = Math.max(1, parseInt(params.page || "1"));
    const search = params.search || "";
    const statusFilter = params.status || "";
    const limit = 50;
    const offset = (page - 1) * limit;

    const { logs, total } = await getEmailAlerts({ limit, offset, status: statusFilter, search });
    const totalPages = Math.ceil(total / limit);

    return (
        <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-6">
            <PageHeader
                eyebrow="Admin / Governance"
                title="Email Log"
                description="History of PIC alert emails sent when a field audit reports devices NOT OK."
                actions={
                    <div className="inline-flex items-center gap-2 rounded-md border border-ops-border bg-ops-surface px-3 py-2 text-sm text-ops-muted">
                        <Mail className="size-4 text-ops-accent" />
                        {total} emails
                    </div>
                }
            />
            <EmailLogClient
                logs={logs}
                total={total}
                page={page}
                totalPages={totalPages}
                search={search}
                statusFilter={statusFilter}
            />
        </main>
    );
}
