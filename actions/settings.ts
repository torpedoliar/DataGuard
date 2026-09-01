"use server";

import { db } from "../db";
import { devices, globalSettings, incidents, sites } from "../db/schema";
import { and, eq, gte } from "drizzle-orm";
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
import { DEFAULT_EMAIL_ALERT_TEMPLATE, DEFAULT_EMAIL_ALERT_SUBJECT, renderEmailTemplate, renderEmailSubject, resetEmailTransporter, sendTestEmail } from "../lib/email";
import { decryptIfEncrypted, encryptString } from "../lib/crypto";
import { resolveNotificationBaseUrl } from "../lib/notification-url";
import { saveUploadFile } from "../lib/upload";
import { formatWibDate, formatWibTime } from "../lib/ui/datetime";

const settingsSchema = z.object({
    appName: z.string().min(1, "Nama aplikasi tidak boleh kosong"),
    activeSiteTelegramChatId: z.string().max(120, "Chat ID Telegram maksimal 120 karakter").optional(),
    telegramBotToken: z.string().max(200, "Token bot Telegram maksimal 200 karakter").optional(),
    telegramAlertTemplate: z.string().max(4000, "Template Telegram maksimal 4000 karakter").optional(),
    emailAlertTemplate: z.string().max(4000, "Template Email maksimal 4000 karakter").optional(),
    emailAlertSubject: z.string().max(500, "Subject Email maksimal 500 karakter").optional(),
});

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

async function handleFileUpload(file: File | null, type: "logo" | "favicon"): Promise<string | null> {
    return saveUploadFile(file, type, {
        kind: type,
        directory: "settings",
    });
}

function defaultSettings() {
    return {
        id: 0,
        appName: "DataGuard",
        logoPath: null,
        faviconPath: null,
        activeSiteName: null,
        activeSiteTelegramChatId: null,
        telegramAlertTemplate: DEFAULT_TELEGRAM_ALERT_TEMPLATE,
        emailAlertTemplate: DEFAULT_EMAIL_ALERT_TEMPLATE,
        emailAlertSubject: DEFAULT_EMAIL_ALERT_SUBJECT,
        telegramBotConfigured: isTelegramBotConfigured(),
        smtpConfigured: Boolean(process.env.SMTP_URL?.trim()),
        smtpUsingEnv: false,
        smtpHost: null,
        smtpPort: null,
        smtpSecure: null,
        smtpUser: null,
        smtpPassSet: false,
        smtpFrom: null,
        smtpFromEnvOnly: false,
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
            // SMTP config is masked: the UI learns whether a relay is set and
            // its non-secret fields (host/port/security/user) — never the
            // password itself.
            const smtpUrlEnv = (process.env.SMTP_URL ?? "").trim();
            const smtpFromEnv = (process.env.SMTP_FROM ?? "").trim();
            const storedPass = decryptIfEncrypted(settingsList[0].smtpPass);
            return {
                id: settingsList[0].id,
                appName: settingsList[0].appName,
                logoPath: settingsList[0].logoPath,
                faviconPath: settingsList[0].faviconPath,
                ...activeSiteTelegram,
                telegramAlertTemplate: settingsList[0].telegramAlertTemplate || DEFAULT_TELEGRAM_ALERT_TEMPLATE,
                emailAlertTemplate: settingsList[0].emailAlertTemplate || DEFAULT_EMAIL_ALERT_TEMPLATE,
                emailAlertSubject: settingsList[0].emailAlertSubject || DEFAULT_EMAIL_ALERT_SUBJECT,
                telegramBotConfigured: isTelegramBotConfigured(settingsList[0].telegramBotToken),
                smtpConfigured: Boolean(
                    smtpUrlEnv
                    || settingsList[0].smtpHost
                    || decryptIfEncrypted(settingsList[0].smtpUrl),
                ),
                smtpUsingEnv: Boolean(smtpUrlEnv),
                smtpHost: settingsList[0].smtpHost || null,
                smtpPort: settingsList[0].smtpPort ?? null,
                smtpSecure: settingsList[0].smtpSecure ?? null,
                smtpUser: settingsList[0].smtpUser || null,
                smtpPassSet: Boolean(storedPass),
                smtpFrom: smtpFromEnv || settingsList[0].smtpFrom || null,
                smtpFromEnvOnly: Boolean(smtpFromEnv) && !settingsList[0].smtpFrom,
            };
        }
    } catch {
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

export async function getEmailAlertTemplate() {
    if (process.env.npm_lifecycle_event === 'build') {
        return DEFAULT_EMAIL_ALERT_TEMPLATE;
    }

    try {
        const settingsList = await db.select({
            emailAlertTemplate: globalSettings.emailAlertTemplate,
        }).from(globalSettings).limit(1);

        return settingsList[0]?.emailAlertTemplate || DEFAULT_EMAIL_ALERT_TEMPLATE;
    } catch {
        return DEFAULT_EMAIL_ALERT_TEMPLATE;
    }
}

export async function getEmailAlertSubject() {
    if (process.env.npm_lifecycle_event === 'build') {
        return DEFAULT_EMAIL_ALERT_SUBJECT;
    }

    try {
        const settingsList = await db.select({
            emailAlertSubject: globalSettings.emailAlertSubject,
        }).from(globalSettings).limit(1);

        return settingsList[0]?.emailAlertSubject || DEFAULT_EMAIL_ALERT_SUBJECT;
    } catch {
        return DEFAULT_EMAIL_ALERT_SUBJECT;
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
        emailAlertTemplate: String(formData.get("emailAlertTemplate") ?? ""),
        emailAlertSubject: String(formData.get("emailAlertSubject") ?? ""),
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
            emailAlertTemplate: parsed.data.emailAlertTemplate?.trim() || DEFAULT_EMAIL_ALERT_TEMPLATE,
            emailAlertSubject: parsed.data.emailAlertSubject?.trim() || DEFAULT_EMAIL_ALERT_SUBJECT,
            updatedAt: new Date(),
        };
        if (parsed.data.telegramBotToken?.trim()) upsertData.telegramBotToken = parsed.data.telegramBotToken.trim();

        // SMTP relay from the UI (Outlook-style structured fields). Password
        // stored encrypted at rest; set-only (empty field keeps the stored
        // one). "Remove SMTP" clears the whole account.
        const smtpHostInput = String(formData.get("smtpHost") ?? "").trim();
        const smtpPortInput = String(formData.get("smtpPort") ?? "").trim();
        const smtpSecureInput = String(formData.get("smtpSecure") ?? "").trim();
        const smtpUserInput = String(formData.get("smtpUser") ?? "").trim();
        const smtpPassInput = String(formData.get("smtpPass") ?? "").trim();
        const removeSmtp = formData.get("removeSmtpUrl") === "true";

        if (smtpHostInput) {
            upsertData.smtpHost = smtpHostInput;
            const port = Number(smtpPortInput);
            upsertData.smtpPort = Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
            upsertData.smtpSecure = ["none", "ssl", "starttls"].includes(smtpSecureInput) ? smtpSecureInput : "starttls";
            upsertData.smtpUser = smtpUserInput || null;
            if (smtpPassInput) upsertData.smtpPass = encryptString(smtpPassInput);
        } else if (removeSmtp) {
            upsertData.smtpHost = null;
            upsertData.smtpPort = null;
            upsertData.smtpSecure = null;
            upsertData.smtpUser = null;
            upsertData.smtpPass = null;
        }
        const smtpFromInput = String(formData.get("smtpFrom") ?? "").trim();
        if (smtpFromInput) {
            upsertData.smtpFrom = smtpFromInput; // sender label, not a secret
        } else if (removeSmtp) {
            upsertData.smtpFrom = null;
        }
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

        // SMTP fields may have changed — drop the cached mail transporter so
        // the next send re-reads the saved credentials.
        resetEmailTransporter();

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

    // Only link a real incident when one exists for this site; a fabricated
    // #TEST link to incident id 1 can 404 and undermines the smoke test.
    // "Recent" = created within the last 14 days.
    const recentIncident = session.activeSiteId
        ? await db.query.incidents.findFirst({
            where: and(
                eq(incidents.siteId, session.activeSiteId),
                gte(incidents.createdAt, new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)),
            ),
            orderBy: (rows, { desc }) => [desc(rows.createdAt)],
            columns: { id: true },
        })
        : null;
    const baseUrl = await resolveNotificationBaseUrl();
    const incidentContext = recentIncident
        ? {
            incidentId: `#${recentIncident.id}`,
            incidentLink: `[Open incident #${recentIncident.id}](${baseUrl}/admin/incidents/${recentIncident.id})`,
        }
        : { incidentId: null, incidentLink: null };

    const message = renderTelegramTemplate(template, {
        siteName: activeSite?.name ?? session.activeSiteName,
        siteCode: activeSite?.code,
        checker: session.username,
        shift: "Test",
        // WIB (Asia/Jakarta) dates — toISOString() slices a UTC date that
        // can skew a day back for Jakarta evenings.
        checkDate: formatWibDate(now),
        checkTime: formatWibTime(now),
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
        ...incidentContext,
    }, {
        trustedMarkdownFields: ["incidentLink"],
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

// Test-send the email alert template to one address. Mirrors
// sendTelegramTestMessage: sample device + recent incident context, rendered
// through the same code path as the real checklist submit (renderEmailTemplate).
export async function sendEmailTestMessage(prevState: unknown, formData: FormData) {
    void prevState;

    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) {
        return { message: "Unauthorized. Only admin can test email settings." };
    }

    const to = String(formData.get("emailTestAddress") ?? "").trim();
    if (!to || !to.includes("@")) return { message: "Alamat email tujuan test wajib diisi." };

    const template = String(formData.get("emailAlertTemplate") ?? "").trim() || DEFAULT_EMAIL_ALERT_TEMPLATE;
    const subjectTemplate = String(formData.get("emailAlertSubject") ?? "").trim() || DEFAULT_EMAIL_ALERT_SUBJECT;
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

    const recentIncident = session.activeSiteId
        ? await db.query.incidents.findFirst({
            where: and(
                eq(incidents.siteId, session.activeSiteId),
                gte(incidents.createdAt, new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)),
            ),
            orderBy: (rows, { desc }) => [desc(rows.createdAt)],
            columns: { id: true },
        })
        : null;
    const baseUrl = await resolveNotificationBaseUrl();
    const incidentContext = recentIncident
        ? {
            incidentId: `#${recentIncident.id}`,
            incidentLink: `[Open incident #${recentIncident.id}](${baseUrl}/admin/incidents/${recentIncident.id})`,
        }
        : { incidentId: null, incidentLink: null };

    const context = {
        siteName: activeSite?.name ?? session.activeSiteName,
        siteCode: activeSite?.code,
        checker: session.username,
        shift: "Test",
        checkDate: formatWibDate(now),
        checkTime: formatWibTime(now),
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
        deviceRemarks: "Test email dari halaman pengaturan",
        ...incidentContext,
    };

    const html = renderEmailTemplate(template, context, { trustedLinkFields: ["incidentLink"] });
    const text = renderEmailTemplate(template, context)
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");

    const testSubject = `[TEST] ${renderEmailSubject(subjectTemplate, {
        ...context,
        groupName: "PIC Test Group",
        deviceCount: 1,
        deviceNames: sampleDevice?.name ?? "TEST",
    })}`;

    // Probe with the SMTP account exactly as typed in the form — the test
    // must reflect what's on screen, not a previously-saved config (the real
    // alerts use the saved one; save when the test passes).
    const formAccount = {
        host: String(formData.get("smtpHost") ?? "").trim(),
        port: Number(formData.get("smtpPort")) || null,
        secure: String(formData.get("smtpSecure") ?? "starttls").trim(),
        user: String(formData.get("smtpUser") ?? "").trim(),
        pass: String(formData.get("smtpPass") ?? "").trim(),
        from: String(formData.get("smtpFrom") ?? "").trim(),
    };
    // Empty password field = the stored one (set-only contract), unless the
    // user is setting up a brand-new host.
    if (!formAccount.pass && formAccount.host) {
        const rows = await db.select({ smtpPass: globalSettings.smtpPass, smtpUser: globalSettings.smtpUser, smtpHost: globalSettings.smtpHost }).from(globalSettings).limit(1);
        const row = rows[0];
        if (row && row.smtpHost === formAccount.host) {
            formAccount.pass = decryptIfEncrypted(row.smtpPass) ?? "";
            if (!formAccount.user) formAccount.user = row.smtpUser ?? "";
        }
    }

    const result = await sendTestEmail(to, testSubject, html, text, formAccount);
    if (!result.success) {
        const raw = result.error || "";
        // 550 5.7.0 Authentication rejected is almost always a server-side
        // policy rejection, not a wrong password per se — surface the usual
        // suspects so the operator can self-diagnose.
        const hint = /5\.7\.0|authentication rejected|535|530/i.test(raw)
            ? " — Penyebab umum: (1) pengirim (From) harus sama dengan akun SMTP/Username, (2) Gmail/365 memakai App Password bukan password login, (3) relay server menolak akun Anda (cek ke admin email)."
            : "";
        return { message: `Gagal: ${raw}${hint}` || "Gagal mengirim email test. Isi konfigurasi SMTP di bawah, atau set SMTP_URL di .env server." };
    }

    await logAudit({
        action: "TEST",
        entity: "settings",
        entityName: "Email",
        detail: `Email test sent to ${to} via ${formAccount.host || "saved/env SMTP"} — ${result.response ?? "accepted"}`,
    });

    // Success at the SMTP layer is NOT delivery — spam filtering, relay
    // routing, and quarantine happen after the server says 250. Show the
    // operator exactly what was accepted, where, and how to trace it.
    const transportDesc = formAccount.host
        ? `${formAccount.host}:${formAccount.port ?? (formAccount.secure === "ssl" ? 465 : formAccount.secure === "none" ? 25 : 587)}`
        : "SMTP tersimpan / env";
    const queueId = result.response?.match(/queued as (\S+)/i)?.[1];
    return {
        success: true,
        message: [
            `Diterima server SMTP (${transportDesc}).`,
            result.response ? `Respons: ${result.response}` : null,
            result.messageId ? `Message-ID: ${result.messageId}` : null,
            queueId ? `Queue ID: ${queueId} — cari ID ini di log mail server kalau email tidak sampai (spam/quarantine/relay routing).` : null,
            "Email belum muncul? Cek folder Spam/Junk dulu, lalu log mail server — penerimaan SMTP sukses bukan jaminan inbox.",
        ].filter(Boolean).join(" "),
    };
}
