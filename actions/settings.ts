"use server";

import { db } from "../db";
import { devices, globalSettings, sites } from "../db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifySession } from "../lib/session";
import { logAudit } from "../lib/audit";
import {
    DEFAULT_TELEGRAM_ALERT_TEMPLATE,
    isTelegramBotConfigured,
    renderTelegramTemplate,
    sendTelegramAlert,
} from "../lib/telegram";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const settingsSchema = z.object({
    appName: z.string().min(1, "Nama aplikasi tidak boleh kosong"),
    activeSiteTelegramChatId: z.string().max(120, "Chat ID Telegram maksimal 120 karakter").optional(),
    telegramBotToken: z.string().max(200, "Token bot Telegram maksimal 200 karakter").optional(),
    telegramAlertTemplate: z.string().max(4000, "Template Telegram maksimal 4000 karakter").optional(),
});

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

const UPLOAD_DIR = path.join(process.cwd(), "public/uploads/settings");

function defaultSettings() {
    return {
        id: 0,
        appName: "DataGuard",
        logoPath: null,
        faviconPath: null,
        activeSiteName: null,
        activeSiteTelegramChatId: null,
        telegramAlertTemplate: DEFAULT_TELEGRAM_ALERT_TEMPLATE,
        telegramBotConfigured: isTelegramBotConfigured(),
    };
}

async function getActiveSiteTelegramSettings() {
    try {
        const session = await verifySession();
        if (!session?.activeSiteId) {
            return {
                activeSiteName: session?.activeSiteName ?? null,
                activeSiteTelegramChatId: null,
            };
        }

        const site = await db.query.sites.findFirst({
            where: eq(sites.id, session.activeSiteId),
            columns: { name: true, telegramChatId: true },
        });

        return {
            activeSiteName: site?.name ?? session.activeSiteName,
            activeSiteTelegramChatId: site?.telegramChatId ?? null,
        };
    } catch {
        return {
            activeSiteName: null,
            activeSiteTelegramChatId: null,
        };
    }
}

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
        return defaultSettings();
    }

    try {
        const settingsList = await db.select().from(globalSettings).limit(1);
        const activeSiteTelegram = await getActiveSiteTelegramSettings();
        if (settingsList.length > 0) {
            return {
                id: settingsList[0].id,
                appName: settingsList[0].appName,
                logoPath: settingsList[0].logoPath,
                faviconPath: settingsList[0].faviconPath,
                ...activeSiteTelegram,
                telegramAlertTemplate: settingsList[0].telegramAlertTemplate || DEFAULT_TELEGRAM_ALERT_TEMPLATE,
                telegramBotConfigured: isTelegramBotConfigured(settingsList[0].telegramBotToken),
            };
        }
    } catch (error) {
        // Hanya warning silent (jangan crash) karena bisa terjadi saat DB sedang booting
        console.warn("Soft fail: Could not fetch global settings from DB. Using defaults.");
    }

    // Default settings if db is empty or errors occur
    return { ...defaultSettings(), ...(await getActiveSiteTelegramSettings()) };
}

export async function getTelegramAlertTemplate() {
    if (process.env.npm_lifecycle_event === 'build') {
        return DEFAULT_TELEGRAM_ALERT_TEMPLATE;
    }

    try {
        const settingsList = await db.select({
            telegramAlertTemplate: globalSettings.telegramAlertTemplate,
        }).from(globalSettings).limit(1);

        return settingsList[0]?.telegramAlertTemplate || DEFAULT_TELEGRAM_ALERT_TEMPLATE;
    } catch {
        return DEFAULT_TELEGRAM_ALERT_TEMPLATE;
    }
}

export async function updateSettings(prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) {
        return { message: "Unauthorized. Only admin can modify settings." };
    }

    const parsed = settingsSchema.safeParse({
        appName: formData.get("appName"),
        activeSiteTelegramChatId: String(formData.get("activeSiteTelegramChatId") ?? ""),
        telegramBotToken: String(formData.get("telegramBotToken") ?? ""),
        telegramAlertTemplate: String(formData.get("telegramAlertTemplate") ?? ""),
    });
    if (!parsed.success) {
        const firstIssue = parsed.error.issues[0]?.message ?? "Data pengaturan tidak valid.";
        return { message: firstIssue, errors: parsed.error.flatten().fieldErrors };
    }

    try {
        // Fetch existing settings
        const currentSettings = await db.select().from(globalSettings).limit(1);
        const settingsId = currentSettings.length > 0 ? currentSettings[0].id : null;

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
                } catch (error: unknown) {
                    return { message: getErrorMessage(error, "Gagal mengunggah logo. Silakan coba lagi.") };
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
                } catch (error: unknown) {
                    return { message: getErrorMessage(error, "Gagal mengunggah favicon. Silakan coba lagi.") };
                }
            }
        }

        const upsertData: Partial<typeof globalSettings.$inferInsert> = {
            appName: parsed.data.appName,
            telegramAlertTemplate: parsed.data.telegramAlertTemplate?.trim() || DEFAULT_TELEGRAM_ALERT_TEMPLATE,
            updatedAt: new Date(),
        };
        if (parsed.data.telegramBotToken?.trim()) upsertData.telegramBotToken = parsed.data.telegramBotToken.trim();
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

        if (session.activeSiteId) {
            await db.update(sites)
                .set({ telegramChatId: parsed.data.activeSiteTelegramChatId?.trim() || null })
                .where(eq(sites.id, session.activeSiteId));
        }

        // Revalidate all pages to force layout update with new metadata and navbar
        revalidatePath("/", "layout");
        revalidatePath("/admin/settings");
        revalidatePath("/admin/sites");

        await logAudit({ action: "UPDATE", entity: "settings", entityName: parsed.data.appName, detail: "Settings updated" });

        return { success: true, message: "Settings saved successfully" };
    } catch (error) {
        console.error("Update settings error:", error);
        return { message: "Terjadi kesalahan saat memperbarui pengaturan. Silakan coba lagi." };
    }
}

export async function sendTelegramTestMessage(prevState: unknown, formData: FormData) {
    void prevState;

    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) {
        return { message: "Unauthorized. Only admin can test Telegram settings." };
    }

    const chatId = String(formData.get("telegramTestChatId") ?? "").trim();
    if (!chatId) return { message: "Chat ID Telegram wajib diisi untuk test." };
    const botToken = String(formData.get("telegramBotToken") ?? "").trim();

    const template = String(formData.get("telegramAlertTemplate") ?? "").trim() || DEFAULT_TELEGRAM_ALERT_TEMPLATE;
    const activeSite = session.activeSiteId
        ? await db.query.sites.findFirst({
            where: eq(sites.id, session.activeSiteId),
            columns: { name: true, code: true },
        })
        : null;
    const sampleDevice = session.activeSiteId
        ? await db.query.devices.findFirst({
            where: eq(devices.siteId, session.activeSiteId),
            with: { brand: true, category: true, location: true },
        })
        : null;
    const rack = [sampleDevice?.rackName, sampleDevice?.rackPosition ? `U${sampleDevice.rackPosition}` : null].filter(Boolean).join(" ");
    const now = new Date();
    const message = renderTelegramTemplate(template, {
        siteName: activeSite?.name ?? session.activeSiteName,
        siteCode: activeSite?.code,
        checker: session.username,
        shift: "Test",
        checkDate: now.toISOString().slice(0, 10),
        checkTime: now.toTimeString().slice(0, 5),
        deviceName: sampleDevice?.name ?? "TEST",
        deviceAssetCode: sampleDevice?.assetCode,
        deviceStatus: "Test",
        deviceLocation: sampleDevice?.location?.name ?? sampleDevice?.location,
        deviceCategory: sampleDevice?.category?.name,
        deviceBrand: sampleDevice?.brand?.name,
        deviceZone: sampleDevice?.zone,
        deviceRack: rack,
        deviceIp: sampleDevice?.ipAddress,
        deviceDescription: sampleDevice?.description,
        deviceRemarks: "Test Telegram dari halaman pengaturan",
        incidentId: "TEST",
    });

    const result = await sendTelegramAlert(chatId, message, botToken);
    if (!result.success) {
        return { message: result.message || "Gagal mengirim pesan test Telegram." };
    }

    await logAudit({
        action: "TEST",
        entity: "settings",
        entityName: "Telegram",
        detail: `Telegram test message sent to ${chatId}`,
    });

    return { success: true, message: "Pesan test Telegram berhasil dikirim." };
}
