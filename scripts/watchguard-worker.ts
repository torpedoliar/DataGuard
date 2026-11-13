import { runWorkerPass, type WorkerConnection, type WorkerPassResult } from "@/lib/epdr/worker-pass";

// Importing orchestration must not load credentials, DB connections or live jobs.
type WorkerJob = { name: string; run: (connectionId: number) => Promise<void> };
type WorkerDependencies = {
  jobs: WorkerJob[];
  getConnections: () => Promise<WorkerConnection[]>;
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
  do {
    try {
      const result = await runPass();
      console.log(`[watchguard-worker] pass complete: ${result.ran} ran, ${result.failed} failed`);
      if (runOnce) return result.failed > 0 ? 1 : 0;
    } catch {
      // Never emit raw provider/DB errors: they may contain credentials or URLs.
      console.error("[watchguard-worker] pass failed");
      if (runOnce) return 1;
    }
    await new Promise((resolve) => setTimeout(resolve, LOOP_MS));
  } while (true);
}

async function main(): Promise<number> {
  await import("dotenv/config");
  const [{ eq }, { db }, { watchguardConnections }, { EPDR_JOBS }] = await Promise.all([
    import("drizzle-orm"), import("@/db"), import("@/db/schema"), import("@/lib/epdr/jobs"),
  ]);
  return runWorker(process.argv.slice(2), {
    jobs: EPDR_JOBS,
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
