"use server";

import { db } from "@/db";
import { locations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export async function getLocations() {
    const session = await verifySession();
    if (!session || !session.activeSiteId) return [];

    try {
        const result = await db.select()
            .from(locations)
            .where(eq(locations.siteId, session.activeSiteId));
        return result;
    } catch (error) {
        console.error("Failed to fetch locations:", error);
        return [];
    }
}

export async function addLocation(prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session || !["superadmin", "admin"].includes(session.role) || !session.activeSiteId) {
        return { success: false, message: "Unauthorized" };
    }

    const name = formData.get("name") as string;
    const description = formData.get("description") as string;

    if (!name) return { success: false, message: "Location name is required" };

    try {
        await db.insert(locations).values({
            name,
            description,
            siteId: session.activeSiteId,
        });
        revalidatePath("/admin/locations");
        await logAudit({ action: "CREATE", entity: "location", entityName: name, detail: description });
        return { success: true, message: "Location added successfully" };
    } catch (error) {
        console.error("Failed to add location:", error);
        return { success: false, message: "Failed to add location" };
    }
}

export async function updateLocation(prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session || !["superadmin", "admin"].includes(session.role) || !session.activeSiteId) {
        return { success: false, message: "Unauthorized" };
    }

    const id = parseInt(formData.get("id") as string, 10);
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;

    if (!id || !name) return { success: false, message: "ID and name are required" };

    try {
        // Ensure user is updating a location within their active site
        const existing = await db.select().from(locations).where(and(eq(locations.id, id), eq(locations.siteId, session.activeSiteId))).limit(1);
        if (existing.length === 0) return { success: false, message: "Location not found or unauthorized" };

        await db.update(locations)
            .set({ name, description })
            .where(eq(locations.id, id));

        revalidatePath("/admin/locations");
        await logAudit({ action: "UPDATE", entity: "location", entityId: id, entityName: name, detail: description });
        return { success: true, message: "Location updated successfully" };
    } catch (error) {
        console.error("Failed to update location:", error);
        return { success: false, message: "Failed to update location" };
    }
}

export async function deleteLocation(formData: FormData) {
    const session = await verifySession();
    if (!session || !["superadmin", "admin"].includes(session.role) || !session.activeSiteId) {
        return { success: false, message: "Unauthorized" };
    }

    const id = parseInt(formData.get("id") as string, 10);
    if (!id) return { success: false, message: "ID is required" };

    try {
        const existing = await db.select().from(locations).where(and(eq(locations.id, id), eq(locations.siteId, session.activeSiteId))).limit(1);
        if (existing.length === 0) return { success: false, message: "Location not found or unauthorized" };

        await db.delete(locations).where(eq(locations.id, id));
        revalidatePath("/admin/locations");
        await logAudit({ action: "DELETE", entity: "location", entityId: id, entityName: existing[0]?.name });
        return { success: true, message: "Location deleted successfully" };
    } catch (error) {
        console.error("Failed to delete location:", error);
        return { success: false, message: "Failed to delete location. It might be in use." };
    }
}
