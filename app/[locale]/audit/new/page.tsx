import { getCategories, getDevices } from "@/actions/master-data";
import { getRacks } from "@/actions/rack-management";
import { getLocations } from "@/actions/locations";
import ChecklistForm from "@/components/checklist/checklist-form";
import ActionButton from "@/components/ui/action-button";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { db } from "@/db";
import { checklistEntries } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { ArrowLeft, QrCode } from "lucide-react";
import { redirect } from "next/navigation";

export default async function NewAuditPage(props: { searchParams: Promise<{ deviceId?: string }> }) {
  const searchParams = await props.searchParams;
  const prefillDeviceId = searchParams?.deviceId ? parseInt(searchParams.deviceId, 10) : undefined;

  const session = await verifySession();
  if (!session) redirect("/login");

  const categories = await getCategories();
  // getRacks returns every rack; audit tabs only cover auditable racks.
  const racks = (await getRacks()).filter((rack) => rack.isAuditable);
  const auditableRackNames = new Set(racks.map((r) => r.name.toLowerCase()));
  // getDevices() returns the full inventory (admin list + edit-reports need
  // every device to manage flags); the AUDIT form filters out
  // excludeChecklist and devices in non-auditable racks.
  const devices = (await getDevices()).filter(
    (device) =>
      !device.excludeChecklist &&
      (!device.rackName || auditableRackNames.has(device.rackName.toLowerCase())),
  );
  // Rooms with a temperature threshold show a temp input on the audit form —
  // unless the room itself is excluded from the temperature check.
  const measuredLocations = (await getLocations())
    .filter((loc) => loc.tempThresholdC !== null && !loc.excludeTempCheck)
    .map(({ id, name, tempC, tempThresholdC }) => ({ id, name, tempC, tempThresholdC }));

  const formattedDevices = devices.map((device) => ({
    ...device,
    categoryId: device.categoryId || 0,
  }));

  const today = new Date();
  const todayIso = today.toISOString().split("T")[0];
  const formattedDate = today.toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const existingTodayEntry = session.activeSiteId
    ? await db.select({
        id: checklistEntries.id,
        checkDate: checklistEntries.checkDate,
        checkTime: checklistEntries.checkTime,
        shift: checklistEntries.shift,
        checker: sql<string>`(select username from users where id = ${checklistEntries.userId})`,
      })
      .from(checklistEntries)
      .where(and(
        eq(checklistEntries.siteId, session.activeSiteId),
        eq(checklistEntries.checkDate, todayIso),
      ))
      .then((res) => res[0] ?? null)
    : null;

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        eyebrow="Operate / Field Audit"
        title="New Audit Entry"
        description={`Field-first checklist for ${formattedDate}. Large status controls are optimized for rack-side entry.`}
        actions={
          <>
            <ActionButton href="/checklist" variant="secondary" icon={<ArrowLeft className="size-4" />}>
              Dashboard
            </ActionButton>
            <ActionButton href="/audit/scan" variant="secondary" icon={<QrCode className="size-4" />}>
              Scan QR
            </ActionButton>
          </>
        }
      />

      <ChecklistForm
        categories={categories}
        devices={formattedDevices}
        racks={racks.map(({ id, name, zone }) => ({ id, name, zone }))}
        measuredLocations={measuredLocations}
        prefillDeviceId={prefillDeviceId}
        existingTodayEntry={existingTodayEntry}
      />
    </main>
  );
}
