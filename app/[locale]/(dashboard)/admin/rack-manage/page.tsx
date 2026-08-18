import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import RackManageClient from "@/components/admin/rack-manage-client";

export default async function RackManagePage() {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

    return <RackManageClient />;
}