import { sql } from "drizzle-orm";
import { db } from "@/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Shared lock order with manual handoff: binding, detection, then Incident work. */
export async function attachDetectionOnce(
  tx: Transaction,
  binding: { connectionId: number; siteId: number; accountRevision: number },
  detectionId: number,
  createOrCorrelate: () => Promise<number | null>,
): Promise<void> {
  const { rows: connections } = await tx.execute(sql`SELECT id FROM watchguard_connections
    WHERE id = ${binding.connectionId} AND site_id = ${binding.siteId} AND enabled
    AND account_revision = ${binding.accountRevision} FOR UPDATE`);
  if (!connections[0]) return;
  const { rows: detections } = await tx.execute<{ incident_id: number | null }>(sql`SELECT incident_id FROM epdr_detections
    WHERE id = ${detectionId} AND connection_id = ${binding.connectionId} AND site_id = ${binding.siteId} AND account_revision = ${binding.accountRevision} FOR UPDATE`);
  if (!detections[0] || detections[0].incident_id !== null) return;
  const incidentId = await createOrCorrelate();
  if (incidentId !== null) await tx.execute(sql`UPDATE epdr_detections SET incident_id = ${incidentId}
    WHERE id = ${detectionId} AND site_id = ${binding.siteId} AND incident_id IS NULL`);
}
