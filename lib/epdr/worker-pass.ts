/**
 * Worker pass orchestration (pure, no DB) — shared by the CLI worker and its
 * tests. One failing connection/job never aborts the others.
 */

export type WorkerConnection = { id: number; endpointSyncMinutes: number; detectionSyncMinutes: number };

/** Interval per job for a connection (minutes). 0 = run every pass. */
export function resolveJobIntervalMinutes(jobName: string, connection: WorkerConnection): number {
  if (jobName === "endpoints") return connection.endpointSyncMinutes;
  // Approved execution requests and their observation are latency-sensitive,
  // and each pass is a bounded, cheap query when the queue is empty.
  if (jobName === "dispatch" || jobName === "tasks") return 0;
  // detection/evaluate/health jobs use the detection cadence.
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

/**
 * A bounded, credential-free description of a job failure for operator logs.
 * Raw messages may carry provider payloads, URLs or credentials, so only typed
 * fields are emitted: a WatchGuard error kind/status, a Postgres SQLSTATE, or
 * one of our own snake_case reason codes.
 */
export function describeWorkerError(error: unknown): string {
  const kinds = new Set(["auth", "forbidden", "not_found", "rate_limited", "server", "network",
    "timeout", "invalid_response", "bad_request", "read_only_blocked"]);
  // Drizzle wraps the driver's error in `cause`. Only inspect bounded typed
  // metadata, never the wrapper's SQL text, parameters or arbitrary message.
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const { kind, status, code, cause } = current as {
      kind?: unknown; status?: unknown; code?: unknown; cause?: unknown;
    };
    if (typeof kind === "string" && kinds.has(kind)) {
      return `kind=${kind}${typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? ` status=${status}` : ""}`;
    }
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return `sqlstate=${code}`;
    current = cause;
  }
  return "error=unknown";
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
      } catch (error) {
        failed++;
        // Raw errors may contain provider payloads, URLs or credentials.
        console.error(`[watchguard-worker] job "${job.name}" failed for connection ${connection.id} (${describeWorkerError(error)})`);
      }
    }
  }
  return { ran, failed };
}