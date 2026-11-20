import { describeWorkerError, runWorkerPass, type WorkerConnection, type WorkerPassResult } from "@/lib/epdr/worker-pass";

// Importing orchestration must not load credentials, DB connections or live jobs.
type WorkerJob = { name: string; run: (connectionId: number) => Promise<void> };
type WorkerDependencies = {
  jobs: WorkerJob[];
  getConnections: () => Promise<WorkerConnection[]>;
  processReadSyncRequests?: () => Promise<void>;
  processNotifications?: () => Promise<void>;
  /** Best-effort liveness upsert after every pass (ran/failed). */
  recordHeartbeat?: (ran: boolean, failed: boolean) => Promise<void>;
};

const LOOP_MS = 60_000;

export function createWorkerRunner({ jobs, getConnections }: WorkerDependencies, only?: string) {
  const selectedJobs = only === undefined ? jobs : jobs.filter((job) => job.name === only);
  if (selectedJobs.length === 0 && only !== undefined) throw new Error("Unknown worker job");
  // Process-local cadence: retained across passes, reset deliberately on restart.
  const lastRun = new Map<string, number>();
  return async (nowMs = Date.now()): Promise<WorkerPassResult> => {
    const rows = await getConnections();
    return runWorkerPass(rows, selectedJobs, lastRun, async (name, connectionId) => {
      await selectedJobs.find((job) => job.name === name)!.run(connectionId);
    }, nowMs);
  };
}

export async function runWorker(args: string[], dependencies: WorkerDependencies): Promise<number> {
  const onlyArg = args.find((arg) => arg.startsWith("--only="));
  const runPass = createWorkerRunner(dependencies, onlyArg?.slice("--only=".length));
  const runOnce = args.includes("--run-once");
  const recordHeartbeat = async (ran: boolean, failed: boolean) => {
    try {
      await dependencies.recordHeartbeat?.(ran, failed);
    } catch {
      // A heartbeat failure must never take the worker down.
      console.error("[watchguard-worker] heartbeat upsert failed");
    }
  };
  do {
    try {
      // Mark liveness before the read-sync pass: a provider read can take
      // minutes, and without an early heartbeat the status panel would call an
      // actively working worker "offline". The end-of-pass write still carries
      // the real ran/failed outcome.
      await recordHeartbeat(true, false);
      let auxiliaryFailed = false;
      if (!onlyArg || onlyArg === "--only=endpoints") {
        try {
          await dependencies.processReadSyncRequests?.();
        } catch (error) {
          auxiliaryFailed = true;
          console.error(`[watchguard-worker] read-sync queue pass failed (${describeWorkerError(error)})`);
        }
      }
      if (!onlyArg) {
        try {
          await dependencies.processNotifications?.();
        } catch (error) {
          // Local notifications must not starve scheduled provider reads.
          auxiliaryFailed = true;
          console.error(`[watchguard-worker] notification pass failed (${describeWorkerError(error)})`);
        }
      }
      const result = await runPass();
      console.log(`[watchguard-worker] pass complete: ${result.ran} ran, ${result.failed} failed`);
      await recordHeartbeat(true, result.failed > 0 || auxiliaryFailed);
      if (runOnce) return result.failed > 0 || auxiliaryFailed ? 1 : 0;
    } catch (error) {
      // Never emit raw provider/DB errors: they may contain credentials or URLs.
      console.error(`[watchguard-worker] pass failed (${describeWorkerError(error)})`);
      await recordHeartbeat(false, true);
      if (runOnce) return 1;
    }
    await new Promise((resolve) => setTimeout(resolve, LOOP_MS));
  } while (true);
}

async function main(): Promise<number> {
  await import("dotenv/config");
  const [{ eq, sql }, { db }, { watchguardConnections }, { EPDR_JOBS, runPendingReadSyncRequests, runLocalNotificationPass }] = await Promise.all([
    import("drizzle-orm"), import("@/db"), import("@/db/schema"), import("@/lib/epdr/jobs"),
  ]);
  const workerId = `worker:${process.pid}`;
  return runWorker(process.argv.slice(2), {
    jobs: EPDR_JOBS,
    processReadSyncRequests: runPendingReadSyncRequests,
    processNotifications: runLocalNotificationPass,
    recordHeartbeat: async (ran, failed) => {
      await db.execute(sql`
        INSERT INTO epdr_worker_heartbeats (worker_id, last_pass_at, last_pass_ran, last_pass_failed, updated_at)
        VALUES (${workerId}, clock_timestamp(), ${ran}, ${failed}, clock_timestamp())
        ON CONFLICT (worker_id) DO UPDATE SET
          last_pass_at = clock_timestamp(), last_pass_ran = ${ran}, last_pass_failed = ${failed},
          updated_at = clock_timestamp()`);
    },
    getConnections: () => db
      .select({ id: watchguardConnections.id, endpointSyncMinutes: watchguardConnections.endpointSyncMinutes, detectionSyncMinutes: watchguardConnections.detectionSyncMinutes })
      .from(watchguardConnections)
      .where(eq(watchguardConnections.enabled, true)),
  });
}

if (require.main === module) {
  void main().then((code) => process.exit(code)).catch(() => {
    console.error("[watchguard-worker] startup failed (check configuration and registered job name)");
    process.exit(1);
  });
}
