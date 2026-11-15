import { and, asc, desc, eq, gte, ilike, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { epdrDetections, epdrEndpoints } from "@/db/schema";

export const THREAT_PAGE_SIZE = 50;
export const THREAT_DAY_MS = 86_400_000;
export const threatQuerySchema = z.object({
  page: z.number().int().min(1).max(100000).default(1),
  query: z.string().trim().max(100).default(""),
  category: z.enum(["all", "malware", "pup", "exploit", "virus", "ioa", "other"]).default("all"),
  source: z.enum(["all", "event_export", "threatsync"]).default("all"),
  scoreMode: z.enum(["any", "range", "missing"]).default("any"),
  minScore: z.number().int().min(0).max(10).default(0),
  maxScore: z.number().int().min(0).max(10).default(10),
  sort: z.enum(["newest", "oldest", "scoreHigh"]).default("newest"),
  ignored: z.boolean().default(false),
}).refine((q) => q.scoreMode !== "range" || q.minScore <= q.maxScore, { message: "Invalid score range", path: ["minScore"] });
export type ThreatQuery = z.infer<typeof threatQuerySchema>;
export function threatOffset(query: ThreatQuery): number { return (query.page - 1) * THREAT_PAGE_SIZE; }

/** Use the same bounded site predicate for table rows and their count. */
export function threatWhere(siteId: number, query: ThreatQuery, now: Date) {
  const pattern = `%${query.query.replace(/[\\%_]/g, "\\$&")}%`;
  return and(
    eq(epdrDetections.siteId, siteId),
    gte(epdrDetections.detectedAt, new Date(now.getTime() - 30 * THREAT_DAY_MS)),
    lte(epdrDetections.detectedAt, now),
    query.ignored ? isNotNull(epdrDetections.ignoredReason) : isNull(epdrDetections.ignoredReason),
    query.category !== "all" ? eq(epdrDetections.category, query.category) : undefined,
    query.source !== "all" ? eq(epdrDetections.source, query.source) : undefined,
    query.scoreMode === "missing" ? isNull(epdrDetections.threatScore) : undefined,
    query.scoreMode === "range" ? and(gte(epdrDetections.threatScore, query.minScore), lte(epdrDetections.threatScore, query.maxScore)) : undefined,
    query.query ? or(ilike(epdrDetections.threatName, pattern), ilike(epdrEndpoints.hostName, pattern)) : undefined,
  );
}
export function threatOrder(query: ThreatQuery) {
  if (query.sort === "oldest") return [asc(epdrDetections.detectedAt), asc(epdrDetections.id)];
  if (query.sort === "scoreHigh") return [sql`${epdrDetections.threatScore} desc nulls last`, desc(epdrDetections.detectedAt), desc(epdrDetections.id)];
  return [desc(epdrDetections.detectedAt), desc(epdrDetections.id)];
}
export function threatEndpointJoin(siteId: number) {
  // Never attach historical detections to identities from a later account
  // revision: a rebind keeps the same connection row but replaces inventory.
  return and(eq(epdrEndpoints.id, epdrDetections.endpointId), eq(epdrEndpoints.siteId, siteId),
    eq(epdrEndpoints.connectionId, epdrDetections.connectionId),
    eq(epdrEndpoints.accountRevision, epdrDetections.accountRevision));
}
