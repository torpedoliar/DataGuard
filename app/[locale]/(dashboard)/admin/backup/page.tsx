import BackupForm from "@/components/admin/backup-form";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";

export const metadata = {
    title: "Backup & Restore | DataGuard Admin",
    description: "Backup dan restore database serta uploads untuk migrasi server.",
};

export default async function BackupPage() {
    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        redirect("/admin");
    }

    return (
        <main className="mx-auto flex w-full max-w-4xl animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
            <PageHeader
                eyebrow="Admin / Backup"
                title="Backup & restore"
                description="Buat ZIP archive berisi pg_dump dan folder uploads, lalu restore ke server tujuan saat migrasi."
            />
            <BackupForm />
        </main>
    );
}
