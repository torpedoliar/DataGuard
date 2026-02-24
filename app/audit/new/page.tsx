
import { getCategories, getDevices } from "@/actions/master-data";
import ChecklistForm from "@/components/checklist/checklist-form";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ClipboardCheck, ArrowLeft } from "lucide-react";

export default async function NewAuditPage(props: { searchParams: Promise<{ deviceId?: string }> }) {
    const searchParams = await props.searchParams;
    const prefillDeviceId = searchParams?.deviceId ? parseInt(searchParams.deviceId) : undefined;

    const session = await verifySession();
    if (!session) redirect("/login");

    const categories = await getCategories();
    const devices = await getDevices();

    const formattedDevices = devices.map(d => ({
        ...d,
        categoryId: d.categoryId || 0
    }));

    // Use ISO date format for consistent rendering
    const today = new Date();
    const dateOptions: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const formattedDate = today.toLocaleDateString("en-GB", dateOptions);

    return (
        <div className="px-4 py-6 sm:px-0">
            <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                    <Link
                        href="/checklist"
                        className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to Checklist
                    </Link>
                </div>

                <div className="flex items-center gap-3 mb-2">
                    <div className="size-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary">
                        <ClipboardCheck className="h-6 w-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">New Audit Entry</h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            Fill out the checklist for {formattedDate}.
                        </p>
                    </div>
                </div>
            </div>

            <ChecklistForm categories={categories} devices={formattedDevices} prefillDeviceId={prefillDeviceId} />
        </div>
    );
}
