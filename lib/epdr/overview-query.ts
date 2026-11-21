import { sql } from "drizzle-orm";
import { OFFLINE_DAYS } from "./posture";

/** Full current-binding aggregate. Exported so isolated PostgreSQL checks run the real statement. */
export function overviewCountsQuery(siteId: number, binding: { id: number; accountRevision: number }, now: Date) {
  return sql`
    WITH fleet AS (
      SELECT accumulated_protection_status AS protection, protection_engine_update_status AS engine,
        knowledge_catalog_update_status AS catalog, last_connection_at
      FROM epdr_endpoints WHERE site_id = ${siteId} AND connection_id = ${binding.id}
        AND account_revision = ${binding.accountRevision} AND removed_at IS NULL
    ), threats AS (
      SELECT threat_score FROM epdr_detections WHERE site_id = ${siteId} AND connection_id = ${binding.id}
        AND account_revision = ${binding.accountRevision} AND ignored_reason IS NULL
        AND detected_at >= ${new Date(now.getTime() - 30 * 86400000)} AND detected_at <= ${now}
    ), actions AS (
      SELECT state FROM epdr_actions WHERE site_id = ${siteId} AND connection_id = ${binding.id}
        AND account_revision = ${binding.accountRevision}
    ) SELECT count(*)::integer AS total,
      -- Match bucketForEndpoint: only enum 1 means outdated; NULL is not enum 1.
      count(*) FILTER (WHERE protection = 1 AND engine IS DISTINCT FROM 1 AND catalog IS DISTINCT FROM 1)::integer AS protected,
      count(*) FILTER (WHERE protection = 2)::integer AS disabled,
      count(*) FILTER (WHERE protection = 3)::integer AS error,
      count(*) FILTER (WHERE protection = 4)::integer AS install_error,
      count(*) FILTER (WHERE protection = 5)::integer AS no_license,
      count(*) FILTER (WHERE protection = 1 AND (engine = 1 OR catalog = 1))::integer AS outdated,
      count(*) FILTER (WHERE protection IS NULL OR protection NOT IN (1,2,3,4,5))::integer AS unknown,
      count(*) FILTER (WHERE last_connection_at < ${new Date(now.getTime() - OFFLINE_DAYS * 86400000)})::integer AS offline,
      count(*) FILTER (WHERE last_connection_at IS NULL)::integer AS unknown_contact,
      (SELECT count(*)::integer FROM threats) AS threats,
      (SELECT count(*)::integer FROM threats WHERE threat_score >= 7) AS "highScore",
      (SELECT count(*)::integer FROM actions WHERE state = 'pending_approval') AS pending,
      (SELECT count(*)::integer FROM actions WHERE state IN ('needs_review', 'outcome_unknown', 'failed', 'partial')) AS review
    FROM fleet`;
}
