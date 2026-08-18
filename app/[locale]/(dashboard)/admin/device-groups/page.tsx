import { getDeviceGroups } from "@/actions/device-groups";
import DeviceGroupsClient from "@/components/admin/device-groups-client";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DeviceGroupsPage() {
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

  // Activate the next-intl request locale so getTranslations below resolves
  // messages for the current /<locale>/admin/device-groups URL.
  const { getLocale } = await import("next-intl/server");
  const locale = await getLocale();
  setRequestLocale(locale);

  const t = await getTranslations("DeviceGroups");

  const groups = await getDeviceGroups();

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        eyebrow={t("pageEyebrow")}
        title={t("pageTitle")}
        description={t("pageDescription")}
        actions={
          <div className="inline-flex items-center gap-2 rounded-md border border-ops-border bg-ops-surface px-3 py-2 text-sm text-ops-muted">
            <Users className="size-4 text-ops-accent" />
            {t("groupCount", { count: groups.length })}
          </div>
        }
      />
      <DeviceGroupsClient initialGroups={groups} />
    </main>
  );
}
