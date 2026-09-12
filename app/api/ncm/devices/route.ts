import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { brands, categories, devices, ncmSettings, sites } from "@/db/schema";
import { decryptIfEncrypted } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ncm/devices
 * Expose site devices to NCM so NCM can sync switch names and details.
 *
 * Auth:
 * - Header `X-API-Key` or `Authorization: Bearer <key>` matching the site's decrypted adminApiKey.
 * - Optional query param `siteId` (defaults to the site identified by the API key).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const xApiKey = req.headers.get("x-api-key");
  let presentedKey = xApiKey?.trim();
  if (!presentedKey && authHeader) {
    const [scheme, val] = authHeader.split(" ");
    if (scheme?.toLowerCase() === "bearer" && val) {
      presentedKey = val.trim();
    }
  }

  // Find matching site from ncm_settings
  const allNcmRows = await db
    .select({
      siteId: ncmSettings.siteId,
      siteName: sites.name,
      adminApiKey: ncmSettings.adminApiKey,
    })
    .from(ncmSettings)
    .innerJoin(sites, eq(sites.id, ncmSettings.siteId));

  let matchedSite: { siteId: number; siteName: string } | null = null;
  if (presentedKey) {
    for (const row of allNcmRows) {
      const decrypted = decryptIfEncrypted(row.adminApiKey);
      if (decrypted && decrypted === presentedKey) {
        matchedSite = { siteId: row.siteId, siteName: row.siteName };
        break;
      }
    }
  }

  // Optional query param override if authorized
  const urlSiteId = req.nextUrl.searchParams.get("siteId");
  let targetSiteId = matchedSite?.siteId;
  if (urlSiteId && Number.isInteger(Number(urlSiteId))) {
    // If a key was provided, verify it has access to that site or is valid
    if (matchedSite && matchedSite.siteId === Number(urlSiteId)) {
      targetSiteId = Number(urlSiteId);
    } else if (!matchedSite) {
      // Check session
      const { verifySession } = await import("@/lib/session");
      const session = await verifySession();
      if (session && ["admin", "superadmin"].includes(session.role)) {
        targetSiteId = Number(urlSiteId);
      }
    }
  }

  if (!targetSiteId) {
    return NextResponse.json(
      { error: "Unauthorized. Missing or invalid NCM API key." },
      { status: 401 }
    );
  }

  const siteRow = allNcmRows.find((r) => r.siteId === targetSiteId);
  const siteName = siteRow?.siteName || `Site #${targetSiteId}`;

  // Query devices belonging to this site that have an IP address or are network devices
  const siteDevices = await db
    .select({
      id: devices.id,
      name: devices.name,
      ip: devices.ipAddress,
      description: devices.description,
      brandName: brands.name,
      categoryName: categories.name,
      isActive: devices.isActive,
    })
    .from(devices)
    .leftJoin(brands, eq(devices.brandId, brands.id))
    .leftJoin(categories, eq(devices.categoryId, categories.id))
    .where(
      and(
        eq(devices.siteId, targetSiteId),
        or(
          isNotNull(devices.ipAddress),
          eq(categories.name, "Switch"),
          eq(categories.name, "Router"),
          eq(categories.name, "Network")
        )
      )
    );

  const formatted = siteDevices.map((d) => {
    const brand = d.brandName ? d.brandName.trim() : "";
    const desc = d.description ? d.description.trim() : "";
    const model = [brand, desc].filter(Boolean).join(" ");
    return {
      id: d.id,
      name: d.name,
      ip: d.ip || "",
      model: model || brand || desc || "",
      category: d.categoryName || "Switch",
      is_active: d.isActive ?? true,
    };
  });

  return NextResponse.json({
    site_id: targetSiteId,
    site_name: siteName,
    total: formatted.length,
    devices: formatted,
  });
}
