"use server";

import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { globalSettings, sites } from "../db/schema";
import { verifySession } from "../lib/session";
import { logAudit } from "../lib/audit";
import { encryptString } from "../lib/crypto";
import { getEnv } from "../lib/env";
import { fetchNetworkDoc, resolveNetworkDocConfig } from "../lib/network-doc";

export type NetworkDocSettingsData = {
    networkDocUrl: string;
    networkDocSiteId: number | null;
    networkDocIntervalMs: number | null;
    networkDocApiKeyConfigured: boolean;
    envOverridesUrl: boolean;
    envOverridesKey: boolean;
    envOverridesSiteId: boolean;
    envOverridesInterval: boolean;
    effectiveUrl: string | null;
    sites: { id: number; name: string }[];
};

export async function getNetworkDocSettings(): Promise<NetworkDocSettingsData | { message: string }> {
    // During NEXT BUILD the DB may be down or absent; hide the card instead
    // of crashing the settings page (same guard as getSettings).
    if (process.env.npm_lifecycle_event === "build") {
        return { message: "Build" };
    }

    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { message: "Unauthorized. Only superadmin can manage Network Docs settings." };
    }

    try {
        const [row, siteList] = await Promise.all([
            db.select({
                networkDocUrl: globalSettings.networkDocUrl,
                networkDocApiKey: globalSettings.networkDocApiKey,
                networkDocSiteId: globalSettings.networkDocSiteId,
                networkDocIntervalMs: globalSettings.networkDocIntervalMs,
            }).from(globalSettings).limit(1),
            db.select({ id: sites.id, name: sites.name }).from(sites).orderBy(asc(sites.name)),
        ]);

        const env = getEnv();
        const effective = await resolveNetworkDocConfig();
        return {
            networkDocUrl: row[0]?.networkDocUrl ?? "",
            networkDocSiteId: row[0]?.networkDocSiteId ?? null,
            networkDocIntervalMs: row[0]?.networkDocIntervalMs ?? null,
            networkDocApiKeyConfigured: Boolean(row[0]?.networkDocApiKey),
            envOverridesUrl: Boolean(env.NETWORK_DOC_URL?.trim()),
            envOverridesKey: Boolean(env.NETWORK_DOC_API_KEY?.trim()),
            envOverridesSiteId: Boolean(env.NETWORK_DOC_SITE_ID?.trim()),
            envOverridesInterval: Boolean(env.NETWORK_DOC_SYNC_INTERVAL_MS?.trim()),
            // The URL the sync/worker actually uses (env wins per field).
            // Shown in the UI so an env override cannot silently override
            // what the operator typed here.
            effectiveUrl: effective.url,
            sites: siteList,
        };
    } catch (error) {
        console.warn("Soft fail: Could not fetch Network Docs settings. Using defaults.");
        return { message: "Could not load Network Docs settings." };
    }
}

const settingsSchema = z.object({
    networkDocUrl: z
        .string()
        .max(200)
        .transform((value) => value.trim())
        .refine((value) => value === "" || /^https?:\/\/.+/.test(value), {
            message: "URL harus http(s)://… atau kosong untuk menghapus.",
        }),
    networkDocApiKey: z.string().max(200).optional(),
    // A fat-fingered interval (e.g. 1000) would turn the restart:always
    // worker into a tight poll loop hammering the API and DB.
    networkDocIntervalMs: z.string().optional().refine(
        (value) => !value || (Number.isInteger(Number(value)) && Number(value) >= 60000),
        { message: "Interval minimal 60.000 ms (1 menit) atau kosong." },
    ),
    networkDocSiteId: z.string().optional().refine(
        (value) => !value || Number.isInteger(Number(value)),
        { message: "Site ID harus berupa angka." },
    ),
});

export async function saveNetworkDocSettings(prevState: unknown, formData: FormData) {
    void prevState;

    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { message: "Unauthorized. Only superadmin can modify Network Docs settings." };
    }

    const parsed = settingsSchema.safeParse({
        networkDocUrl: String(formData.get("networkDocUrl") ?? ""),
        networkDocApiKey: String(formData.get("networkDocApiKey") ?? ""),
        networkDocSiteId: String(formData.get("networkDocSiteId") ?? ""),
        networkDocIntervalMs: String(formData.get("networkDocIntervalMs") ?? ""),
    });
    if (!parsed.success) {
        const firstIssue = parsed.error.issues[0]?.message ?? "Data pengaturan tidak valid.";
        return { message: firstIssue, errors: parsed.error.flatten().fieldErrors };
    }

    try {
        const [existing] = await db.select({ id: globalSettings.id }).from(globalSettings).limit(1);

        const upsertData: Partial<typeof globalSettings.$inferInsert> = {
            networkDocUrl: parsed.data.networkDocUrl || null,
            networkDocSiteId: parsed.data.networkDocSiteId ? Number(parsed.data.networkDocSiteId) || null : null,
            networkDocIntervalMs: parsed.data.networkDocIntervalMs ? Number(parsed.data.networkDocIntervalMs) || null : null,
            updatedAt: new Date(),
        };
        // Write-only key: blank input keeps the stored (encrypted) value.
        if (parsed.data.networkDocApiKey?.trim()) {
            upsertData.networkDocApiKey = encryptString(parsed.data.networkDocApiKey.trim());
        }

        if (existing) {
            await db.update(globalSettings).set(upsertData).where(eq(globalSettings.id, existing.id));
        } else {
            upsertData.networkDocApiKey = upsertData.networkDocApiKey ?? null;
            await db.insert(globalSettings).values(upsertData);
        }

        revalidatePath("/admin/settings");
        revalidatePath("/admin/network-docs");
        await logAudit({ action: "UPDATE", entity: "settings", entityName: "Network Docs Sync", detail: "Settings saved" });

        return { success: true, message: "Pengaturan Network Docs disimpan." };
    } catch (error) {
        console.error("Save network-doc settings error:", error);
        return { message: "Terjadi kesalahan saat menyimpan pengaturan Network Docs." };
    }
}

/**
 * Test the network-doc connection from the server side using the EFFECTIVE
 * config (env overrides included) — surfaces the exact URL attempted so a
 * localhost/container mismatch is obvious.
 */
export async function testNetworkDocConnection() {
    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { ok: false, message: "Unauthorized. Only superadmin can test Network Docs settings." };
    }

    const config = await resolveNetworkDocConfig();
    if (!config.url || !config.apiKey) {
        return {
            ok: false,
            message: "Belum dikonfigurasi: isi URL + API key (dan Site ID untuk worker), lalu simpan.",
        };
    }

    try {
        const switches = await fetchNetworkDoc(config.url, config.apiKey);
        return { ok: true, message: `OK — ${switches.length} switch ditemukan di ${config.url}` };
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
}
