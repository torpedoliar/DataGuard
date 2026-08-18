"use server";

import { db } from "../db";
import { brands, devices } from "../db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveSiteAction } from "../lib/action-auth";
import { verifySession } from "../lib/session";
import { logAudit } from "../lib/audit";
import { saveUploadFile } from "../lib/upload";

const brandSchema = z.object({
    name: z.string().min(1, "Name is required"),
    id: z.coerce.number().optional(),
});

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

async function handleFileUpload(file: File | null): Promise<string | null> {
    return saveUploadFile(file, "brand", { kind: "logo", directory: "brands" });
}

export async function getBrands() {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return [];

    return await db.select().from(brands);
}

export async function addBrand(prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) return { message: "Anda tidak memiliki akses (Unauthorized)." };

    const parsed = brandSchema.safeParse({ name: formData.get("name") });
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

    try {
        let logoPath: string | null = null;
        const logoFile = formData.get("logo") as File | null;

        if (logoFile && logoFile.size > 0) {
            try {
                logoPath = await handleFileUpload(logoFile);
            } catch (error: unknown) {
                return { message: getErrorMessage(error, "Gagal mengunggah logo. Silakan coba lagi.") };
            }
        }

        await db.insert(brands).values({
            name: parsed.data.name,
            logoPath: logoPath,
        });

        revalidatePath("/admin");
        revalidatePath("/admin/brands");
        await logAudit({ action: "CREATE", entity: "brand", entityName: parsed.data.name });
        return { success: true, message: "Brand added successfully" };
    } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
            return { message: "Nama produk/brand ini sudah terdaftar. Silakan gunakan nama lain." };
        }
        console.error("Add brand error:", error);
        return { message: "Terjadi kesalahan saat menambahkan brand. Silakan coba lagi nanti." };
    }
}

export async function updateBrand(prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) return { message: "Anda tidak memiliki akses (Unauthorized)." };

    const parsed = brandSchema.safeParse({
        name: formData.get("name"),
        id: formData.get("id")
    });
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    if (!parsed.data.id) return { message: "ID Brand tidak valid. Gagal memproses." };

    try {
        let logoPath: string | null | undefined = undefined;
        const removeLogo = formData.get("removeLogo") === "true";

        if (removeLogo) {
            logoPath = null;
        } else {
            const logoFile = formData.get("logo") as File | null;
            if (logoFile && logoFile.size > 0) {
                try {
                    logoPath = await handleFileUpload(logoFile);
                } catch (error: unknown) {
                    return { message: getErrorMessage(error, "Gagal mengunggah logo baru. Silakan coba lagi.") };
                }
            }
        }

        const updateData: Partial<typeof brands.$inferInsert> = {
            name: parsed.data.name,
        };

        if (logoPath !== undefined) {
            updateData.logoPath = logoPath;
        }

        await db.update(brands).set(updateData).where(eq(brands.id, parsed.data.id));

        revalidatePath("/admin");
        revalidatePath("/admin/brands");
        await logAudit({ action: "UPDATE", entity: "brand", entityId: parsed.data.id, entityName: parsed.data.name });
        return { success: true, message: "Brand updated successfully" };
    } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
            return { message: "Nama produk/brand ini sudah terdaftar. Silakan gunakan nama lain." };
        }
        console.error("Update brand error:", error);
        return { message: "Terjadi kesalahan saat memperbarui brand. Silakan coba lagi." };
    }
}

export async function deleteBrand(id: number) {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) return { message: "Anda tidak memiliki akses (Unauthorized)." };

    try {
        // Check if brand is connected to any devices
        const devicesWithBrand = await db.query.devices.findMany({
            where: eq(devices.brandId, id),
            columns: { id: true, name: true }
        });

        if (devicesWithBrand.length > 0) {
            return {
                message: "Tidak dapat menghapus brand ini, karena masih digunakan oleh beberapa perangkat terdaftar.",
                usageCount: devicesWithBrand.length,
                devices: devicesWithBrand.map(d => d.name)
            };
        }

        await db.delete(brands).where(eq(brands.id, id));
        revalidatePath("/admin");
        revalidatePath("/admin/brands");
        await logAudit({ action: "DELETE", entity: "brand", entityId: id });
        return { success: true, message: "Brand deleted successfully" };
    } catch (error) {
        console.error("Delete brand error:", error);
        return { message: "Terjadi kesalahan saat menghapus brand. Silakan coba lagi." };
    }
}
