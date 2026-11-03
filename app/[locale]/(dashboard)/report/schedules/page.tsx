import { getReportSchedules } from "@/actions/report-schedules";
import SchedulesTable from "@/components/report/schedules-table";
import { verifySession } from "@/lib/session";
import { hasAdminAccess } from "@/lib/site-access";
import { redirect } from "next/navigation";

export default async function ReportSchedulesPage() {
    const session = await verifySession();
    if (!session) redirect("/login");

    const [schedules, canAdminister] = await Promise.all([
        getReportSchedules(),
        hasAdminAccess(),
    ]);

    return (
        <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
            <SchedulesTable schedules={schedules} canAdminister={canAdminister} />
        </main>
    );
}
