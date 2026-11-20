#!/usr/bin/env tsx
/**
 * Widen the verified EPDR provider-write allowlist for one site.
 *
 * This is a *configuration* tool, not a new capability: actions must already
 * exist in `EXECUTABLE_ACTION_TYPES` with a verified provider contract. Every
 * execution still needs site-admin approval (the requester may approve), recorded
 * in the activity log, passes the policy,
 * cooldown and hourly caps, and remains blocked by either kill switch.
 *
 * The tool only widens lists (it never removes an existing action), never
 * touches a kill switch, and defaults to a dry run. A system audit row is
 * written in the same transaction as the change.
 *
 * Usage:
 *   npx tsx scripts/epdr-enable-writes.ts --list-sites
 *   npx tsx scripts/epdr-enable-writes.ts --site-id=1
 *   npx tsx scripts/epdr-enable-writes.ts --site-id=1 --confirm
 *   npx tsx scripts/epdr-enable-writes.ts --site-id=1 --actions=scan,isolate,unisolate,reboot,assign_config --confirm
 *
 * ThreatSync actions (`ts_*`) can be added explicitly with `--actions`, but
 * they target ThreatSync entities through a confirmed provider target rather
 * than the Endpoint Security device id.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, epdrSiteSettings, sites, watchguardGlobalSettings } from "@/db/schema";
import { EXECUTABLE_ACTION_TYPES } from "@/lib/epdr/capabilities";
import { resolveRequestedActions, widenActions } from "@/lib/epdr/write-activation";

const USAGE = [
  "Usage:",
  "  npx tsx scripts/epdr-enable-writes.ts --list-sites",
  "  npx tsx scripts/epdr-enable-writes.ts --site-id=<id> [--actions=a,b,c] [--confirm]",
].join("\n");

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function isMissingRelation(error: unknown): boolean {
  // Drizzle wraps driver failures; walk the cause chain for the Postgres code.
  const visited = new Set<unknown>();
  for (let current: unknown = error; current && !visited.has(current); current = (current as { cause?: unknown }).cause) {
    visited.add(current);
    const code = (current as { code?: string } | null)?.code;
    if (code === "42P01") return true;
    if (current instanceof Error && /relation .* does not exist/i.test(current.message)) return true;
  }
  return false;
}

async function main(): Promise<void> {
  if (has("list-sites")) {
    const rows = await db.select({ id: sites.id, code: sites.code, name: sites.name }).from(sites).orderBy(sites.id);
    for (const row of rows) console.log(`${row.id}\t${row.code}\t${row.name}`);
    return;
  }

  const siteId = Number(flag("site-id"));
  if (!Number.isInteger(siteId) || siteId <= 0) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const { requested, unknown } = resolveRequestedActions(flag("actions"));
  if (requested.length === 0 || unknown.length > 0) {
    if (unknown.length > 0) console.error(`Unknown or unsupported actions: ${unknown.join(", ")}`);
    console.error(`Verified actions: ${EXECUTABLE_ACTION_TYPES.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const [site] = await db
    .select({ id: sites.id, name: sites.name, code: sites.code })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1);
  if (!site) {
    console.error(`Site ${siteId} not found. Run with --list-sites.`);
    process.exitCode = 1;
    return;
  }

  let global: typeof watchguardGlobalSettings.$inferSelect | undefined;
  let siteSettings: typeof epdrSiteSettings.$inferSelect | undefined;
  try {
    [global] = await db.select().from(watchguardGlobalSettings).where(eq(watchguardGlobalSettings.id, 1)).limit(1);
    [siteSettings] = await db.select().from(epdrSiteSettings).where(eq(epdrSiteSettings.siteId, siteId)).limit(1);
  } catch (error) {
    if (isMissingRelation(error)) {
      console.error("EPDR tables are missing from this database. Run `npm run db:migrate` first.");
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const nextGlobal = widenActions(global?.allowedActions ?? [], requested);
  const nextSite = widenActions(siteSettings?.allowedActions ?? [], requested);

  console.log(`Site: ${site.code} — ${site.name} (id ${site.id})`);
  console.log(`Actions to enable: ${requested.join(", ")}`);
  console.log(`Deployment ceiling: ${(global?.allowedActions ?? []).join(", ") || "(empty)"} -> ${nextGlobal.join(", ")}`);
  console.log(`Site allowlist: ${(siteSettings?.allowedActions ?? []).join(", ") || "(empty)"} -> ${nextSite.join(", ")}`);
  console.log(`Deployment write gate: ${global?.providerWritesEnabled ? "on" : "off"} -> on`);
  console.log(`Site write gate: ${siteSettings?.providerWritesEnabled ? "on" : "off"} -> on`);
  if (global?.killSwitch) console.warn("WARNING: the deployment kill switch is ON; requests stay blocked until it is turned off.");
  if (siteSettings?.siteKillSwitch) console.warn("WARNING: the site kill switch is ON; requests stay blocked until it is turned off.");

  if (!has("confirm")) {
    console.log("Dry run only. Re-run with --confirm to apply.");
    return;
  }

  const detail = `enabled provider writes; requested=${requested.join(",")}; deployment=${nextGlobal.join(",")}; site=${nextSite.join(",")}`;
  await db.transaction(async (tx) => {
    await tx
      .insert(watchguardGlobalSettings)
      .values({ id: 1, allowedActions: nextGlobal, providerWritesEnabled: true, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: watchguardGlobalSettings.id,
        set: { allowedActions: nextGlobal, providerWritesEnabled: true, updatedAt: new Date() },
      });
    await tx
      .insert(epdrSiteSettings)
      .values({ siteId, allowedActions: nextSite, providerWritesEnabled: true })
      .onConflictDoUpdate({
        target: epdrSiteSettings.siteId,
        set: { allowedActions: nextSite, providerWritesEnabled: true, updatedAt: new Date() },
      });
    await tx.insert(auditLogs).values({
      username: "system:epdr-enable-writes",
      userRole: "system",
      action: "UPDATE",
      entity: "settings",
      entityId: siteId,
      entityName: site.name,
      siteId,
      siteName: site.name,
      detail,
    });
  });
  console.log("Applied. Every write request still requires site-admin approval (the requester may approve), recorded in the activity log.");
}

if (require.main === module) {
  void main().catch((error) => {
    console.error("[epdr-enable-writes] failed:", error instanceof Error ? error.message : "unknown error");
    process.exit(1);
  });
}
