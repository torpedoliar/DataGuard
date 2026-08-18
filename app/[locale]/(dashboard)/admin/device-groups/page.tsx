import { getDeviceGroups } from "@/actions/device-groups";
import DeviceGroupsClient from "@/components/admin/device-groups-client";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DeviceGroupsPage() {
  const session = await verifySession();
  if (!session) redirect("/login");

  const groups = await getDeviceGroups();

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        eyebrow="Admin / Governance"
        title="PIC Groups"
        description="Group devices by responsible PIC so a whole group shares one owner. Devices bind to a group, PICs inherit from the group."
        actions={
          <div className="inline-flex items-center gap-2 rounded-md border border-ops-border bg-ops-surface px-3 py-2 text-sm text-ops-muted">
            <Users className="size-4 text-ops-accent" />
            {groups.length} groups
          </div>
        }
      />
      <DeviceGroupsClient initialGroups={groups} />
    </main>
  );
}
