import { getCategories, getDevices } from "@/actions/master-data";
import ChecklistForm from "@/components/checklist/checklist-form";
import ActionButton from "@/components/ui/action-button";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { ArrowLeft, QrCode } from "lucide-react";
import { redirect } from "next/navigation";

export default async function NewAuditPage(props: { searchParams: Promise<{ deviceId?: string }> }) {
  const searchParams = await props.searchParams;
  const prefillDeviceId = searchParams?.deviceId ? parseInt(searchParams.deviceId, 10) : undefined;

  const session = await verifySession();
  if (!session) redirect("/login");

  const categories = await getCategories();
  const devices = await getDevices();

  const formattedDevices = devices.map((device) => ({
    ...device,
    categoryId: device.categoryId || 0,
  }));

  const today = new Date();
  const formattedDate = today.toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

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

      <ChecklistForm categories={categories} devices={formattedDevices} prefillDeviceId={prefillDeviceId} />
    </main>
  );
}
