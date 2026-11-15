import { z } from "zod";

export const fleetQuerySchema = z.object({
  page: z.number().int().min(1).max(100000).default(1),
  query: z.string().trim().max(80).default(""),
  filter: z.enum(["all", "attention", "offline", "outdated", "unlinked", "unknown_contact"]).default("all"),
  group: z.string().max(255).default(""),
  os: z.string().max(255).default(""),
  sort: z.enum(["name", "contact"]).default("name"),
});
export type FleetQuery = z.infer<typeof fleetQuerySchema>;
export const FLEET_PAGE_SIZE = 50;
export function fleetOffset(query: FleetQuery): number { return (query.page - 1) * FLEET_PAGE_SIZE; }
