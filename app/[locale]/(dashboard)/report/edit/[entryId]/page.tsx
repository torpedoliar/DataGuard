import { getChecklistEntry } from "@/actions/checklist";
import { getCategories, getDevices } from "@/actions/master-data";
import EditChecklistForm from "@/components/checklist/edit-checklist-form";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";

export default async function EditChecklistPage({
    params,
}: {
    params: Promise<{ entryId: string }>;
}) {
    const session = await verifySession();
    if (!session) redirect("/login");

    const { entryId } = await params;

    let entry;
    try {
        entry = await getChecklistEntry(Number(entryId));
    } catch (error) {
        console.error("Failed to get checklist entry:", error);
    }

    if (!entry) {
        notFound();
    }

    const categories = await getCategories();
    const devices = await getDevices();

    const formattedDevices = devices.map(d => ({
        ...d,
        categoryId: d.categoryId || 0,
    }));

    const formattedItems = (entry.items || []).map((item) => ({
        ...item,
        device: {
            ...item.device,
            locationName: formattedDevices.find(d => d.id === item.deviceId)?.locationName || null
        }
    })) as React.ComponentProps<typeof EditChecklistForm>["items"];

    return (
        <EditChecklistForm
            entryId={entry.id}
            checkDate={entry.checkDate}
            checkTime={entry.checkTime}
            shift={entry.shift}
            categories={categories}
            devices={formattedDevices}
            items={formattedItems}
        />
    );
}
