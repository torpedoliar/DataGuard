/**
 * Worker pass orchestration (pure, no DB) — shared by the CLI worker and its
 * tests. One failing connection/job never aborts the others.
 */

export type WorkerConnection = { id: number; endpointSyncMinutes: number; detectionSyncMinutes: number };

/** Interval per job for a connection (minutes). 0 = run every pass. */
export function resolveJobIntervalMinutes(jobName: string, connection: WorkerConnection): number {
  if (jobName === "endpoints") return connection.endpointSyncMinutes;
  // detection/evaluate/tasks jobs use the detection cadence when they land.
  return connection.detectionSyncMinutes;
}

export function shouldRunJob(
  jobName: string,
  connection: WorkerConnection,
  { nowMs, lastRunMs }: { nowMs: number; lastRunMs: number | null },
): boolean {
  if (lastRunMs === null) return true;
  const intervalMs = resolveJobIntervalMinutes(jobName, connection) * 60 * 1000;
  return nowMs - lastRunMs >= intervalMs;
}

export type WorkerPassResult = { ran: number; failed: number };

export async function runWorkerPass(
  connections: WorkerConnection[],
  jobs: { name: string }[],
  lastRun: Map<string, number>,
  runJob: (name: string, connectionId: number) => Promise<void>,
  nowMs: number = Date.now(),
): Promise<WorkerPassResult> {
  let ran = 0;
  let failed = 0;
  for (const connection of connections) {
    for (const job of jobs) {
      const key = `${connection.id}:${job.name}`;
      if (!shouldRunJob(job.name, connection, { nowMs, lastRunMs: lastRun.get(key) ?? null })) continue;
      try {
        await runJob(job.name, connection.id);
        lastRun.set(key, nowMs);
        ran++;
      } catch {
        failed++;
        // Raw errors may contain provider payloads, URLs or credentials.
        console.error(`[watchguard-worker] job "${job.name}" failed for connection ${connection.id}`);
      }
    }
  }
  return { ran, failed };
}