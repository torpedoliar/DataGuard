"use server";

import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { globalSettings, networkDocSettings, sites } from "../db/schema";
import { verifySession } from "../lib/session";
import { logAudit } from "../lib/audit";
import { encryptString } from "../lib/crypto";
import { getEnv } from "../lib/env";
import { fetchNetworkDoc, resolveNetworkDocConfig } from "../lib/network-doc";

export type NetworkDocSiteConfig = {
    siteId: number;
    siteName: string;
    url: string; // stored value (may be "")
    apiKeyConfigured: boolean;
    usesEnvDefault: boolean; // stored url is empty and env provides one
    effectiveUrl: string | null; // url the sync/worker actually uses
};

export type NetworkDocSettingsData = {
    sites: NetworkDocSiteConfig[];
    workerIntervalMs: number | null;
    envOverridesInterval: boolean;
    envHasUrl: boolean;
    envHasKey: boolean;
    sitesWithoutConfig: { id: number; name: string }[];
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
        const [siteList, rowList, intervalRows] = await Promise.all([
            db.select({ id: sites.id, name: sites.name }).from(sites).orderBy(asc(sites.name)),
            db.select({
                siteId: networkDocSettings.siteId,
                url: networkDocSettings.url,
                apiKey: networkDocSettings.apiKey,
            }).from(networkDocSettings),
            db.select({ intervalMs: globalSettings.networkDocIntervalMs }).from(globalSettings).limit(1),
        ]);
        const rowsBySite = new Map(rowList.map((row) => [row.siteId, row]));

        const env = getEnv();
        const envUrl = env.NETWORK_DOC_URL?.trim();
        const envKey = env.NETWORK_DOC_API_KEY?.trim();

        const siteConfigs: NetworkDocSiteConfig[] = [];
        const sitesWithoutConfig: { id: number; name: string }[] = [];
        for (const site of siteList) {
            const row = rowsBySite.get(site.id);
            const url = row?.url ?? "";
            const effective = await resolveNetworkDocConfig(site.id);
            siteConfigs.push({
                siteId: site.id,
                siteName: site.name,
                url,
                apiKeyConfigured: Boolean(row?.apiKey),
                usesEnvDefault: !url && Boolean(envUrl),
                effectiveUrl: effective.url,
            });
            if (!url && !row?.apiKey && !envUrl && !envKey) {
                sitesWithoutConfig.push({ id: site.id, name: site.name });
            }
        }

        return {
            sites: siteConfigs,
            workerIntervalMs: intervalRows[0]?.intervalMs ?? null,
            envOverridesInterval: Boolean(env.NETWORK_DOC_SYNC_INTERVAL_MS?.trim()),
            envHasUrl: Boolean(envUrl),
            envHasKey: Boolean(envKey),
            sitesWithoutConfig,
        };
    } catch (error) {
        console.warn("Soft fail: Could not fetch Network Docs settings. Using defaults.");
        return { message: "Could not load Network Docs settings." };
    }
}

const siteSchema = z.object({
    networkDocSiteId: z.string().refine((value) => Number.isInteger(Number(value)), {
        message: "Site ID harus berupa angka.",
    }),
    networkDocUrl: z
        .string()
        .max(200)
        .transform((value) => value.trim())
        .refine((value) => value === "" || /^https?:\/\/.+/.test(value), {
            message: "URL harus http(s)://… atau kosong untuk menghapus.",
        }),
    networkDocApiKey: z.string().max(200).optional(),
});

export async function saveNetworkDocSettings(prevState: unknown, formData: FormData) {
    void prevState;

    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { message: "Unauthorized. Only superadmin can modify Network Docs settings." };
    }

    const parsed = siteSchema.safeParse({
        networkDocSiteId: String(formData.get("networkDocSiteId") ?? ""),
        networkDocUrl: String(formData.get("networkDocUrl") ?? ""),
        networkDocApiKey: String(formData.get("networkDocApiKey") ?? ""),
    });
    if (!parsed.success) {
        const firstIssue = parsed.error.issues[0]?.message ?? "Data pengaturan tidak valid.";
        return { message: firstIssue, errors: parsed.error.flatten().fieldErrors };
    }

    const siteId = Number(parsed.data.networkDocSiteId);
    const url = parsed.data.networkDocUrl || null;
    const apiKey = parsed.data.networkDocApiKey?.trim() || null;

    try {
        const [existing] = await db.select({ siteId: networkDocSettings.siteId })
            .from(networkDocSettings)
            .where(eq(networkDocSettings.siteId, siteId));

        if (!url && !apiKey) {
            // Disable the site's sync: drop its row entirely.
            if (!existing) return { success: true, message: "Pengaturan disimpan (site belum terkonfigurasi)." };
            await db.delete(networkDocSettings).where(eq(networkDocSettings.siteId, siteId));
        } else if (existing) {
            const update: Partial<typeof networkDocSettings.$inferInsert> = { url, updatedAt: new Date() };
            if (apiKey) update.apiKey = encryptString(apiKey);
            await db.update(networkDocSettings).set(update).where(eq(networkDocSettings.siteId, siteId));
        } else {
            await db.insert(networkDocSettings).values({
                siteId,
                url,
                apiKey: apiKey ? encryptString(apiKey) : null,
                updatedAt: new Date(),
            });
        }

        revalidatePath("/admin/settings");
        revalidatePath("/admin/network-docs");
        await logAudit({ action: "UPDATE", entity: "settings", entityName: "Network Docs Sync", entityId: siteId, detail: "Per-site settings saved" });

        return { success: true, message: "Pengaturan Network Docs disimpan." };
    } catch (error) {
        console.error("Save network-doc settings error:", error);
        return { message: "Terjadi kesalahan saat menyimpan pengaturan Network Docs." };
    }
}

const intervalSchema = z.object({
    networkDocIntervalMs: z.string().optional().refine(
        (value) => !value || (Number.isInteger(Number(value)) && Number(value) >= 60000),
        { message: "Interval minimal 60.000 ms (1 menit) atau kosong." },
    ),
});

export async function saveNetworkDocWorkerInterval(prevState: unknown, formData: FormData) {
    void prevState;

    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { message: "Unauthorized. Only superadmin can modify Network Docs settings." };
    }

    const parsed = intervalSchema.safeParse({
        networkDocIntervalMs: String(formData.get("networkDocIntervalMs") ?? ""),
    });
    if (!parsed.success) {
        return { message: parsed.error.issues[0]?.message ?? "Interval tidak valid." };
    }

    try {
        const [existing] = await db.select({ id: globalSettings.id }).from(globalSettings).limit(1);
        const intervalMs = parsed.data.networkDocIntervalMs ? Number(parsed.data.networkDocIntervalMs) : null;
        if (existing) {
            await db.update(globalSettings).set({ networkDocIntervalMs: intervalMs, updatedAt: new Date() })
                .where(eq(globalSettings.id, existing.id));
        } else {
            await db.insert(globalSettings).values({ networkDocIntervalMs: intervalMs });
        }

        revalidatePath("/admin/settings");
        await logAudit({ action: "UPDATE", entity: "settings", entityName: "Network Docs Worker Interval", detail: "Interval saved" });

        return { success: true, message: "Interval worker disimpan." };
    } catch (error) {
        console.error("Save network-doc interval error:", error);
        return { message: "Terjadi kesalahan saat menyimpan interval." };
    }
}

/**
 * Test one site's network-doc connection from the server side using the
 * EFFECTIVE config (row + env default) — surfaces the exact URL attempted.
 */
export async function testNetworkDocConnection(prevState: unknown, formData: FormData) {
    void prevState;

    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { ok: false, message: "Unauthorized. Only superadmin can test Network Docs settings." };
    }

    const siteId = Number(formData.get("networkDocSiteId"));
    if (!Number.isInteger(siteId)) {
        return { ok: false, message: "Site ID tidak valid." };
    }

    const config = await resolveNetworkDocConfig(siteId);
    if (!config.url || !config.apiKey) {
        return {
            ok: false,
            message: "Belum dikonfigurasi: isi URL + API key untuk site, lalu simpan.",
        };
    }

    try {
        const switches = await fetchNetworkDoc(config.url, config.apiKey);
        return { ok: true, message: `OK — ${switches.length} switch (${config.url})` };
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
}