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
import { resolveNetworkDocConfig } from "../lib/network-doc";

export type NetworkDocSettingsData = {
    networkDocUrl: string;
    networkDocSiteId: number | null;
    networkDocIntervalMs: number | null;
    networkDocApiKeyConfigured: boolean;
    envOverridesUrl: boolean;
    envOverridesKey: boolean;
    envOverridesSiteId: boolean;
    sites: { id: number; name: string }[];
};

export async function getNetworkDocSettings(): Promise<NetworkDocSettingsData | { message: string }> {
    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { message: "Unauthorized. Only superadmin can manage Network Docs settings." };
    }

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
    return {
        networkDocUrl: row[0]?.networkDocUrl ?? "",
        networkDocSiteId: row[0]?.networkDocSiteId ?? null,
        networkDocIntervalMs: row[0]?.networkDocIntervalMs ?? null,
        networkDocApiKeyConfigured: Boolean(row[0]?.networkDocApiKey),
        envOverridesUrl: Boolean(env.NETWORK_DOC_URL?.trim()),
        envOverridesKey: Boolean(env.NETWORK_DOC_API_KEY?.trim()),
        envOverridesSiteId: Boolean(env.NETWORK_DOC_SITE_ID?.trim()),
        sites: siteList,
    };
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
    networkDocSiteId: z.string().optional(),
    networkDocIntervalMs: z.string().optional(),
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
