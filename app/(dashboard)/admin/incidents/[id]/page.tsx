import { getAssignableIncidentUsers, getIncidentDetail } from "@/actions/incidents";
import IncidentDetail from "@/components/admin/incident-detail";
import { verifySession } from "@/lib/session";
import { hasAdminAccess } from "@/lib/site-access";
import { notFound, redirect } from "next/navigation";

export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession();
  if (!session) redirect("/login");
  if (!session.activeSiteId) redirect("/select-site");

  const { id } = await params;
  const incidentId = Number(id);
  if (!incidentId) notFound();

  const incident = await getIncidentDetail(incidentId);
  if (!incident) notFound();

  const canAdmin = await hasAdminAccess();
  const users = canAdmin ? await getAssignableIncidentUsers() : [];

  return <IncidentDetail incident={incident} users={users} canAdmin={canAdmin} />;
}
