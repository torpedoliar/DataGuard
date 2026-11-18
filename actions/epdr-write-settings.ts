"use server";

/**
 * Provider write enablement.
 *
 * Two independent gates must both be on before any request can be created:
 * the deployment-wide flag (superadmin only) and the per-site flag (site admin).
 * Both default to off and turning either one on requires an explicit
 * confirmation flag, so a mis-click cannot enable writes.
 *
 * The per-site action list is a *narrowing* of the global ceiling. An empty
 * list means no actions, never all actions.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { requireActiveSiteAdminAction, requireSuperadminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { EXECUTABLE_ACTION_TYPES } from "@/lib/epdr/capabilities";
import { DEFAULT_EXECUTION_COOLDOWN_MINUTES } from "@/lib/epdr/execution-store";

export type WriteSettingsError = { code: "invalid_input" | "forbidden" | "service_unavailable" };

export type WriteSettings = {
  globalEnabled: boolean;
  siteEnabled: boolean;
  globalKillSwitch: boolean;
  siteKillSwitch: boolean;
  globalAllowedActions: string[];
  siteAllowedActions: string[];
  approvalExpiryMinutes: number;
  /** Global hourly cap; the per-site value may narrow it, never raise it. */
  globalMaxActionsPerHour: number;
  /** Per-site hourly cap; null = follow the global value. */
  siteMaxActionsPerHour: number | null;
  /** Minimum minutes between two writes to the same endpoint+action. */
  executionCooldownMinutes: number;
  isSuperadmin: boolean;
  availableActions: string[];
};

const saveSchema = z.object({
  globalEnabled: z.boolean().optional(),
  siteEnabled: z.boolean().optional(),
  siteAllowedActions: z.array(z.string().min(1).max(64)).max(32).optional(),
  globalAllowedActions: z.array(z.string().min(1).max(64)).max(32).optional(),
  siteMaxActionsPerHour: z.number().int().min(1).max(10_000).nullable().optional(),
  executionCooldownMinutes: z.number().int().min(0).max(1440).optional(),
  confirmWriteEnablement: z.literal(true),
}).strict();

function sanitizeActions(values: string[]): string[] {
  const allowed = new Set<string>(EXECUTABLE_ACTION_TYPES);
  return [...new Set(values.filter((value) => allowed.has(value)))].sort();
}

export async function getEpdrWriteSettings(): Promise<WriteSettings | WriteSettingsError> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { code: "forbidden" };
  try {
    const { rows } = await db.execute<{
      global_enabled: boolean | null;
      global_kill_switch: boolean | null;
      global_allowed_actions: string[] | null;
      approval_expiry_minutes: number | null;
      global_max_actions_per_hour: number | null;
      site_enabled: boolean | null;
      site_kill_switch: boolean | null;
      site_allowed_actions: string[] | null;
      site_max_actions_per_hour: number | null;
      execution_cooldown_minutes: number | null;
    }>(sql`
      SELECT g.provider_writes_enabled AS global_enabled, g.kill_switch AS global_kill_switch,
        g.allowed_actions AS global_allowed_actions, g.approval_expiry_minutes,
        g.max_actions_per_hour_per_site AS global_max_actions_per_hour,
        s.provider_writes_enabled AS site_enabled, s.site_kill_switch,
        s.allowed_actions AS site_allowed_actions,
        s.max_actions_per_hour AS site_max_actions_per_hour, s.execution_cooldown_minutes
      FROM (SELECT 1) AS anchor
      LEFT JOIN watchguard_global_settings g ON g.id = 1
      LEFT JOIN epdr_site_settings s ON s.site_id = ${guard.activeSiteId}`);
    const row = rows[0];
    return {
      globalEnabled: row?.global_enabled === true,
      siteEnabled: row?.site_enabled === true,
      globalKillSwitch: row?.global_kill_switch === true,
      siteKillSwitch: row?.site_kill_switch === true,
      globalAllowedActions: row?.global_allowed_actions ?? [],
      siteAllowedActions: row?.site_allowed_actions ?? [],
      approvalExpiryMinutes: row?.approval_expiry_minutes ?? 60,
      globalMaxActionsPerHour: row?.global_max_actions_per_hour ?? 30,
      siteMaxActionsPerHour: row?.site_max_actions_per_hour ?? null,
      executionCooldownMinutes: row?.execution_cooldown_minutes ?? DEFAULT_EXECUTION_COOLDOWN_MINUTES,
      isSuperadmin: guard.session.role === "superadmin",
      availableActions: [...EXECUTABLE_ACTION_TYPES],
    };
  } catch {
    return { code: "service_unavailable" };
  }
}

export async function saveEpdrWriteSettings(input: unknown): Promise<{ ok: true } | WriteSettingsError> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { code: "forbidden" };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { code: "invalid_input" };

  try {
    // The deployment-wide flag is a superadmin decision, never a site admin one.
    const touchesGlobal = parsed.data.globalEnabled !== undefined || parsed.data.globalAllowedActions !== undefined;
    if (touchesGlobal) {
      const superadmin = await requireSuperadminAction();
      if (!superadmin.ok) return { code: "forbidden" };
    }

    const saved = await db.transaction(async (tx) => {
      if (parsed.data.globalEnabled !== undefined || parsed.data.globalAllowedActions !== undefined) {
        const updated = await tx.execute(sql`
          UPDATE watchguard_global_settings SET
            provider_writes_enabled = ${parsed.data.globalEnabled === undefined
              ? sql`provider_writes_enabled`
              : sql`${parsed.data.globalEnabled}`},
            allowed_actions = ${parsed.data.globalAllowedActions
              ? sql`${sanitizeActions(parsed.data.globalAllowedActions)}::text[]`
              : sql`allowed_actions`},
            updated_by = ${guard.session.userId}, updated_at = clock_timestamp()
          WHERE id = 1`);
        // A missing global row would otherwise look like a successful save.
        if ((updated.rowCount ?? 0) !== 1) return false;
      }
      if (parsed.data.siteEnabled !== undefined || parsed.data.siteAllowedActions !== undefined
        || parsed.data.siteMaxActionsPerHour !== undefined
        || parsed.data.executionCooldownMinutes !== undefined) {
        // The site cap narrows the global ceiling; a wider value is a config
        // mistake, not a raise.
        if (parsed.data.siteMaxActionsPerHour != null) {
          const { rows: capRows } = await tx.execute<{ global_cap: number | null }>(sql`
            SELECT max_actions_per_hour_per_site AS global_cap FROM watchguard_global_settings WHERE id = 1`);
          const globalCap = capRows[0]?.global_cap;
          if (globalCap != null && Number(parsed.data.siteMaxActionsPerHour) > Number(globalCap)) {
            return "cap_above_global";
          }
        }
        const actions = sanitizeActions(parsed.data.siteAllowedActions ?? []);
        const capProvided = parsed.data.siteMaxActionsPerHour !== undefined;
        await tx.execute(sql`
          INSERT INTO epdr_site_settings (site_id, provider_writes_enabled, allowed_actions,
            max_actions_per_hour, execution_cooldown_minutes, updated_by, updated_at)
          VALUES (${guard.activeSiteId}, ${parsed.data.siteEnabled ?? false},
            ${sql`${actions}::text[]`},
            ${capProvided ? parsed.data.siteMaxActionsPerHour : null},
            ${parsed.data.executionCooldownMinutes ?? DEFAULT_EXECUTION_COOLDOWN_MINUTES},
            ${guard.session.userId}, clock_timestamp())
          ON CONFLICT (site_id) DO UPDATE SET
            provider_writes_enabled = coalesce(${parsed.data.siteEnabled ?? null}, epdr_site_settings.provider_writes_enabled),
            allowed_actions = ${parsed.data.siteAllowedActions
              ? sql`${actions}::text[]`
              : sql`epdr_site_settings.allowed_actions`},
            max_actions_per_hour = ${capProvided
              ? sql`${parsed.data.siteMaxActionsPerHour}`
              : sql`epdr_site_settings.max_actions_per_hour`},
            execution_cooldown_minutes = ${parsed.data.executionCooldownMinutes !== undefined
              ? sql`${parsed.data.executionCooldownMinutes}`
              : sql`epdr_site_settings.execution_cooldown_minutes`},
            updated_by = ${guard.session.userId}, updated_at = clock_timestamp()`);
      }
      return true;
    });
    if (saved === "cap_above_global") return { code: "invalid_input" };
    if (!saved) return { code: "service_unavailable" };
    await logAudit({
      action: "EPDR_EXECUTION",
      entity: "settings",
      entityId: guard.activeSiteId,
      entityName: `site ${guard.activeSiteId}`,
      detail: JSON.stringify({
        event: "write_enablement",
        globalEnabled: parsed.data.globalEnabled,
        siteEnabled: parsed.data.siteEnabled,
        globalActions: parsed.data.globalAllowedActions ? sanitizeActions(parsed.data.globalAllowedActions) : undefined,
        siteActions: parsed.data.siteAllowedActions ? sanitizeActions(parsed.data.siteAllowedActions) : undefined,
        siteMaxActionsPerHour: parsed.data.siteMaxActionsPerHour,
        executionCooldownMinutes: parsed.data.executionCooldownMinutes,
      }),
    });
    return { ok: true };
  } catch {
    return { code: "service_unavailable" };
  }
}
