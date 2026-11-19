import { z } from "zod";

/** WatchGuard device-type enum values shown in the fleet table and filter. */
export const FLEET_DEVICE_TYPES = [1, 2, 3, 4] as const;

export const fleetQuerySchema = z.object({
  page: z.number().int().min(1).max(100000).default(1),
  query: z.string().trim().max(80).default(""),
  filter: z.enum(["all", "attention", "offline", "outdated", "unlinked", "unknown_contact"]).default("all"),
  group: z.string().max(255).default(""),
  os: z.string().max(255).default(""),
  /** Empty = every device type; otherwise one of the documented enum values. */
  deviceType: z.union([z.literal(""), z.enum(["1", "2", "3", "4"])]).default(""),
  /** name = A–Z, contact = latest connection first, protection = attention first. */
  sort: z.enum(["name", "contact", "protection"]).default("name"),
});
export type FleetQuery = z.infer<typeof fleetQuerySchema>;
export const FLEET_PAGE_SIZE = 50;
export function fleetOffset(query: FleetQuery): number { return (query.page - 1) * FLEET_PAGE_SIZE; }
