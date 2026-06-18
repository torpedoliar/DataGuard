import { getAssignableIncidentUsers, getIncidentDetail } from "@/actions/incidents";
import IncidentDetail from "@/components/admin/incident-detail";
import ErrorState from "@/components/ui/error-state";
import { verifySession } from "@/lib/session";
import { hasAdminAccess } from "@/lib/site-access";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession();
  if (!session) redirect("/login");
  if (!session.activeSiteId) redirect("/select-site");

  const { id } = await params;
  const incidentId = Number(id);
  if (!incidentId) notFound();

  const incident = await getIncidentDetail(incidentId);
  if (!incident) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-10">
        <ErrorState
          icon={<ShieldAlert className="size-6" />}
          title="Incident not found"
          description="This incident may have been deleted or never existed in the active site. Return to the incident center to choose another."
          action={
            <Link
              href="/admin/incidents"
              className="inline-flex h-9 items-center justify-center rounded-md border border-ops-border bg-ops-surface px-4 text-sm font-semibold text-ops-text transition-colors hover:border-ops-accent/50"
            >
              Back to incidents
            </Link>
          }
        />
      </main>
    );
  }

  const canAdmin = await hasAdminAccess();
  const users = canAdmin ? await getAssignableIncidentUsers() : [];
  const isAssignee = incident.assignedToId === session.userId;

  return <IncidentDetail incident={incident} users={users} canAdmin={canAdmin} isAssignee={isAssignee} />;
}
