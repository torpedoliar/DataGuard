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
        <div className="flex flex-col gap-6 p-4 sm:p-6">
            <SchedulesTable schedules={schedules} canAdminister={canAdminister} />
        </div>
    );
}
