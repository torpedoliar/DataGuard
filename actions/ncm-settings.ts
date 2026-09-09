"use server";

import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { ncmSettings, sites } from "../db/schema";
import { verifySession } from "../lib/session";
import { logAudit } from "../lib/audit";
import { encryptString } from "../lib/crypto";
import { fetchNcmSwitches, resolveNcmConfig, touchNcmLastSeen } from "../lib/ncm";

export type NcmSiteConfig = {
    siteId: number;
    siteName: string;
    url: string; // stored value (may be "")
    apiKeyConfigured: boolean;
    lastSeenAt: Date | null;
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
                lastSeenAt: ncmSettings.lastSeenAt,
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
                lastSeenAt: row?.lastSeenAt ?? null,
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
