/**
 * Execution retention for the provider-write pipeline.
 *
 * Windows (per site, DB CHECK 7..3650):
 * - attempts of terminal actions are deleted after `execution_attempt_retention_days` (default 90);
 * - `epdr_actions.result` and retained attempt responses are redacted after
 *   `execution_result_retention_days` (default 180).
 *
 * `epdr_actions` rows, their frozen snapshots and the approval facts are
 * permanent — the decision record outlives the technical evidence. Deletion is
 * batched with `FOR UPDATE SKIP LOCKED` so a retention pass never blocks a
 * dispatcher and never deletes a request whose state changed mid-pass (only
 * terminal actions qualify; anything else keeps its attempts).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { logAudit } from "@/lib/audit";

export const DEFAULT_ATTEMPT_RETENTION_DAYS = 90;
export const DEFAULT_RESULT_RETENTION_DAYS = 180;

export type RetentionWindows = { attemptDays: number; resultDays: number };

/** Pure: the site windows with their safe defaults. */
export function effectiveRetentionWindows(
  attemptDays: number | null | undefined,
  resultDays: number | null | undefined,
): RetentionWindows {
  return {
    attemptDays: attemptDays ?? DEFAULT_ATTEMPT_RETENTION_DAYS,
    resultDays: resultDays ?? DEFAULT_RESULT_RETENTION_DAYS,
  };
}

/** Pure: cutoff timestamp (ms) for a window ending at `nowMs`. */
export function retentionCutoffMs(nowMs: number, days: number): number {
  return nowMs - days * 24 * 60 * 60 * 1000;
}

export type RetentionResult = {
  redactedResults: number;
  redactedResponses: number;
  deletedAttempts: number;
};

/**
 * One retention pass across all sites. Every statement is bounded and
 * lock-skipping; concurrent workers may run this safely (idempotent: the
 * second pass finds nothing left to touch).
 */
export async function runExecutionRetention({ batchSize = 500 } = {}): Promise<RetentionResult> {
  // 1. Redact receipts on terminal actions past the result window.
  const { rows: resultRows } = await db.execute<{ id: number }>(sql`
    UPDATE epdr_actions x SET result = NULL, updated_at = clock_timestamp()
    WHERE x.id IN (
      SELECT x2.id FROM epdr_actions x2
      JOIN sites st ON st.id = x2.site_id
      LEFT JOIN epdr_site_settings s ON s.site_id = x2.site_id
      WHERE x2.mode = 'approval' AND x2.namespace IS NOT NULL
        AND x2.state IN ('completed', 'failed', 'cancelled')
        AND x2.result IS NOT NULL
        AND x2.updated_at < clock_timestamp() - (interval '1 day' * coalesce(s.execution_result_retention_days, ${DEFAULT_RESULT_RETENTION_DAYS}))
      FOR UPDATE OF x2 SKIP LOCKED
      LIMIT ${batchSize})
    RETURNING x.id`);
  const redactedResults = resultRows.length;

  // 2. Redact response payloads on retained attempts (matters when the attempt
  //    window is configured longer than the result window).
  const { rows: responseRows } = await db.execute<{ id: number }>(sql`
    UPDATE epdr_attempts a SET response = NULL
    WHERE a.id IN (
      SELECT a2.id FROM epdr_attempts a2
      JOIN epdr_actions x ON x.id = a2.action_id
      JOIN sites st ON st.id = x.site_id
      LEFT JOIN epdr_site_settings s ON s.site_id = x.site_id
      WHERE x.mode = 'approval' AND x.namespace IS NOT NULL
        AND x.state IN ('completed', 'failed', 'cancelled')
        AND a2.response IS NOT NULL
        AND a2.started_at < clock_timestamp() - (interval '1 day' * coalesce(s.execution_result_retention_days, ${DEFAULT_RESULT_RETENTION_DAYS}))
      FOR UPDATE OF a2 SKIP LOCKED
      LIMIT ${batchSize})
    RETURNING a.id`);
  const redactedResponses = responseRows.length;

  // 3. Delete attempts of terminal actions past the attempt window. A request
  //    that is not terminal keeps its attempts: the ledger is the only proof
  //    of what was sent.
  const { rows: deletedRows } = await db.execute<{ id: number }>(sql`
    DELETE FROM epdr_attempts a
    WHERE a.id IN (
      SELECT a2.id FROM epdr_attempts a2
      JOIN epdr_actions x ON x.id = a2.action_id
      JOIN sites st ON st.id = x.site_id
      LEFT JOIN epdr_site_settings s ON s.site_id = x.site_id
      WHERE x.mode = 'approval' AND x.namespace IS NOT NULL
        AND x.state IN ('completed', 'failed', 'cancelled')
        AND a2.started_at < clock_timestamp() - (interval '1 day' * coalesce(s.execution_attempt_retention_days, ${DEFAULT_ATTEMPT_RETENTION_DAYS}))
      FOR UPDATE OF a2 SKIP LOCKED
      LIMIT ${batchSize})
    RETURNING a.id`);
  const deletedAttempts = deletedRows.length;

  await logAudit({
    action: "UPDATE",
    entity: "settings",
    entityName: "EPDR Execution Retention",
    detail: JSON.stringify({ event: "retention_pass", redactedResults, redactedResponses, deletedAttempts }),
  });

  return { redactedResults, redactedResponses, deletedAttempts };
}
