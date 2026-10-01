"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { locations } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { appearanceFormSchema, resolveAppearance, type RoomAppearance } from "@/lib/room-appearance";
import { deleteUploadFile, saveUploadFile, UploadValidationError } from "@/lib/upload";

export type AppearanceResult = { success: true; appearance: RoomAppearance } | { success: false; message: string };

// Saves the 3D look of one room (site admins). A custom wallpaper image
// follows the floor-plan pattern: save the file first, swap the path under a
// row lock, delete the replaced file afterwards, remove the new file if the
// write fails.
export async function updateRoomAppearance(locationId: number, formData: FormData): Promise<AppearanceResult> {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { success: false, message: auth.message };

    const parsed = appearanceFormSchema.safeParse({
        lightColor: formData.get("lightColor") ?? "",
        lightBrightness: formData.get("lightBrightness"),
        wallpaper: formData.get("wallpaper"),
        wallpaperMode: formData.get("wallpaperMode") ?? "tile",
    });
    if (!parsed.success) return { success: false, message: "Invalid appearance settings." };
    const input = parsed.data;

    const [location] = await db
        .select({ id: locations.id, name: locations.name, wallpaperPath: locations.wallpaperPath })
        .from(locations)
        .where(and(eq(locations.id, locationId), eq(locations.siteId, auth.activeSiteId)))
        .limit(1);
    if (!location) return { success: false, message: "Location not found in the active site." };

    let newPath: string | null = null;
    if (input.wallpaper === "custom") {
        try {
            newPath = await saveUploadFile(formData.get("wallpaperFile") as File | null, `wallpaper-${locationId}`, { kind: "logo", directory: "wallpapers" });
        } catch (error) {
            if (error instanceof UploadValidationError) return { success: false, message: error.message };
            throw error;
        }
        if (!newPath && !location.wallpaperPath) return { success: false, message: "Upload an image for a custom wallpaper." };
    }

    let oldPath: string | null = null;
    let finalPath: string | null = null;
    try {
        await db.transaction(async (tx) => {
            const [locked] = await tx.select({ wallpaperPath: locations.wallpaperPath })
                .from(locations).where(eq(locations.id, locationId)).for("update");
            oldPath = locked?.wallpaperPath ?? null;
            finalPath = input.wallpaper === "custom" ? newPath ?? oldPath : null;
            await tx.update(locations)
                .set({
                    lightColor: input.lightColor,
                    lightBrightness: input.lightBrightness,
                    wallpaper: input.wallpaper,
                    wallpaperMode: input.wallpaperMode,
                    wallpaperPath: finalPath,
                })
                .where(eq(locations.id, locationId));
        });
    } catch (error) {
        if (newPath) await deleteUploadFile(newPath);
        console.error("Failed to update room appearance:", error);
        return { success: false, message: "Failed to save the room appearance." };
    }

    if (oldPath && oldPath !== finalPath) await deleteUploadFile(oldPath);

    revalidatePath("/admin/rack");
    await logAudit({ action: "UPDATE", entity: "location", entityId: locationId, entityName: location.name, detail: "3D room appearance" });
    return { success: true, appearance: resolveAppearance({ ...input, wallpaperPath: finalPath }) };
}
