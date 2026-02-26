"use server";

import { db } from "../db";
import { globalSettings } from "../db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifySession } from "../lib/session";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const settingsSchema = z.object({
    appName: z.string().min(1, "Nama aplikasi tidak boleh kosong"),
});

const UPLOAD_DIR = path.join(process.cwd(), "public/uploads/settings");

// Initialize upload directory
async function ensureUploadDir() {
    try {
        await fs.access(UPLOAD_DIR);
    } catch {
        await fs.mkdir(UPLOAD_DIR, { recursive: true });
    }
}

async function handleFileUpload(file: File | null, type: 'logo' | 'favicon'): Promise<string | null> {
    if (!file || file.size === 0) return null;

    await ensureUploadDir();

    // Validate file type
    if (type === 'favicon') {
        if (!file.type.includes("icon") && !file.type.startsWith("image/")) {
            throw new Error("Invalid favicon file type. Only icons/images are allowed.");
        }
    } else {
        if (!file.type.startsWith("image/")) {
            throw new Error("Invalid logo file type. Only images are allowed.");
        }
    }

    // Generate unique filename
    const ext = path.extname(file.name) || (type === 'favicon' ? '.ico' : '.png');
    const uniqueId = crypto.randomUUID();
    const filename = `${type}_${uniqueId}${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);

    // Write array buffer to disk
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await fs.writeFile(filePath, buffer);

    // Return relative URL path
    return `/uploads/settings/${filename}`;
}

export async function getSettings() {
    // Pada saat NEXT BUILD di Docker, DB connection string mungkin invalid atau DB belum menyala.
    // Cegah crash dengan langsung me-return default saat fase build.
    if (process.env.npm_lifecycle_event === 'build') {
        return {
            id: 0,
            appName: "DataGuard",
            logoPath: null,
            faviconPath: null,
        };
    }

    try {
        const settingsList = await db.select().from(globalSettings).limit(1);
        if (settingsList.length > 0) {
            return {
                id: settingsList[0].id,
                appName: settingsList[0].appName,
                logoPath: settingsList[0].logoPath,
                faviconPath: settingsList[0].faviconPath,
            };
        }
    } catch (error) {
        // Hanya warning silent (jangan crash) karena bisa terjadi saat DB sedang booting
        console.warn("Soft fail: Could not fetch global settings from DB. Using defaults.");
    }

    // Default settings if db is empty or errors occur
    return {
        id: 0,
        appName: "DataGuard",
        logoPath: null,
        faviconPath: null,
    };
}

export async function updateSettings(prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { message: "Unauthorized. Only superadmin can modify global settings." };
    }

    const parsed = settingsSchema.safeParse({ appName: formData.get("appName") });
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

    try {
        // Fetch existing settings
        let currentSettings = await db.select().from(globalSettings).limit(1);
        let settingsId = currentSettings.length > 0 ? currentSettings[0].id : null;

        let logoPath: string | null | undefined = undefined;
        let faviconPath: string | null | undefined = undefined;

        // Handle Logo Removal
        if (formData.get("removeLogo") === "true") {
            logoPath = null;
        } else {
            const logoFile = formData.get("logo") as File | null;
            if (logoFile && logoFile.size > 0) {
                try {
                    logoPath = await handleFileUpload(logoFile, 'logo');
                } catch (err: any) {
                    return { message: err.message || "Gagal mengunggah logo. Silakan coba lagi." };
                }
            }
        }

        // Handle Favicon Removal
        if (formData.get("removeFavicon") === "true") {
            faviconPath = null;
        } else {
            const faviconFile = formData.get("favicon") as File | null;
            if (faviconFile && faviconFile.size > 0) {
                try {
                    faviconPath = await handleFileUpload(faviconFile, 'favicon');
                } catch (err: any) {
                    return { message: err.message || "Gagal mengunggah favicon. Silakan coba lagi." };
                }
            }
        }

        const upsertData: any = {
            appName: parsed.data.appName,
        };
        if (logoPath !== undefined) upsertData.logoPath = logoPath;
        if (faviconPath !== undefined) upsertData.faviconPath = faviconPath;

        if (settingsId) {
            await db.update(globalSettings).set(upsertData).where(eq(globalSettings.id, settingsId));
        } else {
            // First time setup
            // Resolve undefined fields to null for insert
            upsertData.logoPath = upsertData.logoPath ?? null;
            upsertData.faviconPath = upsertData.faviconPath ?? null;
            await db.insert(globalSettings).values(upsertData);
        }

        // Revalidate all pages to force layout update with new metadata and navbar
        revalidatePath("/", "layout");

        return { success: true, message: "Settings saved successfully" };
    } catch (error) {
        console.error("Update settings error:", error);
        return { message: "Terjadi kesalahan saat memperbarui pengaturan. Silakan coba lagi." };
    }
}
