"use server";

import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { ncmSettings, sites } from "../db/schema";
import { verifySession } from "../lib/session";
import { logAudit } from "../lib/audit";
import { encryptString, decryptIfEncrypted } from "../lib/crypto";
import { fetchNcmSwitches, resolveNcmConfig, setNcmWebhook, touchNcmLastSeen } from "../lib/ncm";
import { checkNcmSite, ncmHeartbeatDeps, NCM_OFFLINE_THRESHOLD } from "../lib/ncm-heartbeat";

export type NcmSiteConfig = {
    siteId: number;
    siteName: string;
    url: string; // stored value (may be "")
    apiKeyConfigured: boolean;
    webhookUrl: string; // stored value (may be ""); pushed to NCM on save
    webhookConfigured: boolean; // inbound HMAC secret present in ncm_settings
    lastSeenAt: Date | null;
    status: "online" | "offline" | null; // fleet heartbeat (ticket 09)
};

export type NcmSettingsData = {
    sites: NcmSiteConfig[];
    sitesWithoutConfig: { id: number; name: string }[];
};

export async function getNcmSettings(): Promise<NcmSettingsData | { message: string }> {
    // During NEXT BUILD the DB may be down or absent; hide the card instead
    // of crashing the settings page (same guard as getNetworkDocSettings).
    if (process.env.npm_lifecycle_event === "build") {
        return { message: "Build" };
    }

    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { message: "Unauthorized. Only superadmin can manage NCM settings." };
    }

    try {
        const [siteList, rowList] = await Promise.all([
            db.select({ id: sites.id, name: sites.name }).from(sites).orderBy(asc(sites.name)),
            db.select({
                siteId: ncmSettings.siteId,
                url: ncmSettings.url,
                adminApiKey: ncmSettings.adminApiKey,
                webhookUrl: ncmSettings.webhookUrl,
                webhookSecret: ncmSettings.webhookSecret,
                lastSeenAt: ncmSettings.lastSeenAt,
                status: ncmSettings.status,
            }).from(ncmSettings),
        ]);
        const rowsBySite = new Map(rowList.map((row) => [row.siteId, row]));

        const siteConfigs: NcmSiteConfig[] = [];
        const sitesWithoutConfig: { id: number; name: string }[] = [];
        for (const site of siteList) {
            const row = rowsBySite.get(site.id);
            const url = row?.url ?? "";
            siteConfigs.push({
                siteId: site.id,
                siteName: site.name,
                url,
                apiKeyConfigured: Boolean(row?.adminApiKey),
                webhookUrl: row?.webhookUrl ?? "",
                webhookConfigured: Boolean(row?.webhookSecret),
                lastSeenAt: row?.lastSeenAt ?? null,
                status: (row?.status as "online" | "offline" | null) ?? null,
            });
            if (!url && !row?.adminApiKey) {
                sitesWithoutConfig.push({ id: site.id, name: site.name });
            }
        }

        return { sites: siteConfigs, sitesWithoutConfig };
    } catch {
        console.warn("Soft fail: Could not fetch NCM settings. Using defaults.");
        return { message: "Could not load NCM settings." };
    }
}

const siteSchema = z.object({
    ncmSiteId: z.string().refine((value) => Number.isInteger(Number(value)), {
        message: "Site ID harus berupa angka.",
    }),
    ncmUrl: z
        .string()
        .max(200)
        .transform((value) => value.trim())
        .refine((value) => value === "" || /^https?:\/\/.+/.test(value), {
            message: "URL harus http(s)://.. atau kosong untuk menghapus.",
        }),
    ncmAdminApiKey: z.string().max(500).optional(),
});

export async function saveNcmSettings(prevState: unknown, formData: FormData) {
    void prevState;

    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { message: "Unauthorized. Only superadmin can modify NCM settings." };
    }

    const parsed = siteSchema.safeParse({
        ncmSiteId: String(formData.get("ncmSiteId") ?? ""),
        ncmUrl: String(formData.get("ncmUrl") ?? ""),
        ncmAdminApiKey: String(formData.get("ncmAdminApiKey") ?? ""),
    });
    if (!parsed.success) {
        const firstIssue = parsed.error.issues[0]?.message ?? "Data pengaturan tidak valid.";
        return { message: firstIssue, errors: parsed.error.flatten().fieldErrors };
    }

    const siteId = Number(parsed.data.ncmSiteId);
    const url = parsed.data.ncmUrl || null;
    const adminApiKey = parsed.data.ncmAdminApiKey?.trim() || null;

    try {
        const [existing] = await db.select({ siteId: ncmSettings.siteId })
            .from(ncmSettings)
            .where(eq(ncmSettings.siteId, siteId));

        if (!url && !adminApiKey) {
            // Disable the site NCM connection: drop its row entirely.
            if (!existing) return { success: true, message: "Pengaturan disimpan (site belum terkonfigurasi)." };
            await db.delete(ncmSettings).where(eq(ncmSettings.siteId, siteId));
        } else if (existing) {
            const update: Partial<typeof ncmSettings.$inferInsert> = { url, updatedAt: new Date() };
            if (adminApiKey) update.adminApiKey = encryptString(adminApiKey);
            await db.update(ncmSettings).set(update).where(eq(ncmSettings.siteId, siteId));
        } else {
            await db.insert(ncmSettings).values({
                siteId,
                url,
                adminApiKey: adminApiKey ? encryptString(adminApiKey) : null,
                updatedAt: new Date(),
            });
        }

        revalidatePath("/admin/settings");
        await logAudit({ action: "UPDATE", entity: "settings", entityName: "NCM Settings", entityId: siteId, detail: "Per-site settings saved" });

        return { success: true, message: "Pengaturan NCM disimpan." };
    } catch {
        console.error("Save NCM settings error:");
        return { message: "Terjadi kesalahan saat menyimpan pengaturan NCM." };
    }
}

/**
 * Test one site NCM connection from the server side using the EFFECTIVE
 * config (decrypted row) - surfaces the exact URL attempted and stamps the
 * lastSeenAt heartbeat on success.
 */
export async function testNcmConnection(prevState: unknown, formData: FormData) {
    void prevState;

    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { ok: false, message: "Unauthorized. Only superadmin can test NCM settings." };
    }

    const siteId = Number(formData.get("ncmSiteId"));
    if (!Number.isInteger(siteId)) {
        return { ok: false, message: "Site ID tidak valid." };
    }

    const config = await resolveNcmConfig(siteId);
    if (!config.url || !config.adminApiKey) {
        return {
            ok: false,
            message: "Belum dikonfigurasi: isi URL + admin API key untuk site, lalu simpan.",
        };
    }

    try {
        await fetchNcmSwitches({ url: config.url, adminApiKey: config.adminApiKey });
        await touchNcmLastSeen(siteId);
        return { ok: true, message: "OK - NCM terhubung (" + config.url + ")" };
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
}

const cronSchema = z.object({
    ncmSiteId: z.string().refine((value) => Number.isInteger(Number(value)) && Number(value) > 0, {
        message: "Site ID tidak valid.",
    }),
});

/**
 * Ticket 09: superadmin "check now" — runs the same heartbeat the fleet
 * worker uses for one site (last_seen/status/miss_count + incident rules),
 * but surfaces a human-readable message. The UI button calls this with
 * formAction, exactly like testNcmConnection.
 */
export async function checkNcmNow(prevState: unknown, formData: FormData) {
    void prevState;

    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { ok: false, message: "Unauthorized. Only superadmin can run the NCM heartbeat." };
    }

    const parsed = cronSchema.safeParse({ ncmSiteId: String(formData.get("ncmSiteId") ?? "") });
    if (!parsed.success) {
        return { ok: false, message: parsed.error.issues[0]?.message ?? "Site ID tidak valid." };
    }

    const siteId = Number(parsed.data.ncmSiteId);
    const [site] = await db.select({ name: sites.name }).from(sites).where(eq(sites.id, siteId));
    if (!site) {
        return { ok: false, message: "Site tidak ditemukan." };
    }

    try {
        const outcome = await checkNcmSite(ncmHeartbeatDeps, { siteId, siteName: site.name });
        if (!outcome.configured) {
            return { ok: false, message: "Belum dikonfigurasi: isi URL + admin API key untuk site, lalu simpan." };
        }
        revalidatePath("/admin/settings");
        if (outcome.ok) {
            return { ok: true, message: `OK - NCM merespons (status: ${outcome.status}).` };
        }
        const misses = outcome.missCount ?? 0;
        const thresholdNote = misses >= NCM_OFFLINE_THRESHOLD
            ? ` — OFFLINE, insiden ${outcome.incidentId ? `#${outcome.incidentId}` : "(sudah ada)"} terkait.`
            : ` (miss ${misses}/${NCM_OFFLINE_THRESHOLD}).`;
        return { ok: false, message: `Gagal: ${outcome.error}${thresholdNote}` };
    } catch {
        return { ok: false, message: "Terjadi kesalahan saat menjalankan heartbeat NCM." };
    }
}

const webhookSchema = z.object({
    ncmSiteId: z.string().refine((value) => Number.isInteger(Number(value)), {
        message: "Site ID harus berupa angka.",
    }),
    ncmWebhookUrl: z
        .string()
        .max(500) // NCM NotifySettingsPatch caps webhook_url at 500
        .transform((value) => value.trim())
        .refine((value) => value === "" || /^https?:\/\/.+/.test(value), {
            message: "URL webhook harus http(s)://.. atau kosong untuk menghapus.",
        }),
    ncmWebhookSecret: z.string().max(500), // NCM caps webhook_secret at 500
});

/**
 * Ticket 08: webhook NCM dikonfigurasi 100% via UI. Persists the webhook URL
 * + HMAC secret per site (secret encrypted at-rest, same envelope as the
 * admin API key), then pushes both into NCM's notify settings with the
 * stored admin API key (scope system:write). The DB write wins: if the NCM
 * push fails, the form shows the NCM error and a retry is one click away.
 */
export async function saveNcmWebhook(prevState: unknown, formData: FormData) {
    void prevState;

    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { ok: false, message: "Unauthorized. Only superadmin can modify NCM webhook settings." };
    }

    const parsed = webhookSchema.safeParse({
        ncmSiteId: String(formData.get("ncmSiteId") ?? ""),
        ncmWebhookUrl: String(formData.get("ncmWebhookUrl") ?? ""),
        ncmWebhookSecret: String(formData.get("ncmWebhookSecret") ?? ""),
    });
    if (!parsed.success) {
        const firstIssue = parsed.error.issues[0]?.message ?? "Data webhook tidak valid.";
        return { ok: false, message: firstIssue, errors: parsed.error.flatten().fieldErrors };
    }

    const siteId = Number(parsed.data.ncmSiteId);
    const webhookUrl = parsed.data.ncmWebhookUrl;
    const webhookSecret = parsed.data.ncmWebhookSecret.trim();
    let storedSecret: string | null = null;

    try {
        const [existing] = await db.select({
            adminApiKey: ncmSettings.adminApiKey,
            webhookSecret: ncmSettings.webhookSecret,
        })
            .from(ncmSettings)
            .where(eq(ncmSettings.siteId, siteId));
        if (!existing) {
            return { ok: false, message: "Site belum terhubung ke NCM: isi URL + admin API key, lalu simpan." };
        }
        storedSecret = existing.webhookSecret;

        const update: Partial<typeof ncmSettings.$inferInsert> = { updatedAt: new Date() };
        if (webhookUrl !== "") update.webhookUrl = webhookUrl;
        else update.webhookUrl = null;
        if (webhookSecret !== "") update.webhookSecret = encryptString(webhookSecret);
        await db.update(ncmSettings).set(update).where(eq(ncmSettings.siteId, siteId));
        revalidatePath("/admin/settings");
    } catch {
        console.error("Save NCM webhook settings error:");
        return { ok: false, message: "Terjadi kesalahan saat menyimpan pengaturan webhook." };
    }

    const config = await resolveNcmConfig(siteId);
    if (!config.url || !config.adminApiKey) {
        return { ok: false, message: "Tersimpan lokal, tapi NCM belum terkonfigurasi (URL + admin API key) untuk push." };
    }

    // Secret: keep the stored one when the field is left blank (same UX as
    // the admin API key); blank + nothing stored clears the NCM side.
    const effectiveSecret = webhookSecret !== "" ? webhookSecret : (decryptIfEncrypted(storedSecret) ?? "");
    try {
        await setNcmWebhook({ url: config.url, adminApiKey: config.adminApiKey }, webhookUrl, effectiveSecret);
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }

    await logAudit({ action: "UPDATE", entity: "settings", entityName: "NCM Webhook", entityId: siteId, detail: "Webhook config pushed to NCM" });
    return { ok: true, message: "Webhook dikonfigurasi di NCM (" + config.url + ")." };
}
