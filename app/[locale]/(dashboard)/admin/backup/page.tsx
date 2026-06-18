import BackupForm from "@/components/admin/backup-form";
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
        <div className="py-8 px-6 max-w-4xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-white tracking-tight">Backup &amp; Restore</h1>
                <p className="text-sm text-slate-400 mt-1">
                    Buat ZIP archive berisi pg_dump dan folder uploads, lalu restore ke server tujuan saat migrasi.
                </p>
            </div>
            <BackupForm />
        </div>
    );
}
