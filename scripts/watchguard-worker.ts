import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { watchguardConnections } from "@/db/schema";
import { EPDR_JOBS, hasJob } from "@/lib/epdr/jobs";
import { runWorkerPass } from "@/lib/epdr/worker-pass";

// One-shot (--run-once) or the scheduled loop worker for the EPDR pipeline.
// Pattern: scripts/network-doc-worker.ts. Only enabled connections run jobs;
// one failing connection never stops the others. `--only=<job>` filters to one
// registered job (validated against lib/epdr/jobs.ts).

const RUN_ONCE = process.argv.includes("--run-once");
const LOOP_MS = 60_000;

async function runOnce(): Promise<void> {
  const rows = await db
    .select({ id: watchguardConnections.id, endpointSyncMinutes: watchguardConnections.endpointSyncMinutes, detectionSyncMinutes: watchguardConnections.detectionSyncMinutes })
    .from(watchguardConnections)
    .where(eq(watchguardConnections.enabled, true));

  const lastRun = new Map<string, number>();
  const result = await runWorkerPass(rows, EPDR_JOBS, lastRun, async (name, connectionId) => {
    const job = EPDR_JOBS.find((j) => j.name === name);
    if (!job) throw new Error(`Unknown job: ${name}`);
    await job.run(connectionId);
  });
  console.log(`[watchguard-worker] run-once complete: ${result.ran} ran, ${result.failed} failed`);
}

async function loop(): Promise<void> {
  while (true) {
    try {
      await runOnce();
    } catch (error) {
      console.error("[watchguard-worker] pass failed:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, LOOP_MS));
  }
}

if (require.main === module) {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  if (onlyArg) {
    const name = onlyArg.split("=")[1]!;
    if (!hasJob(name)) {
      console.error(`[watchguard-worker] unknown job "${name}". Registered: ${EPDR_JOBS.map((j) => j.name).join(", ")}`);
      process.exit(1);
    }
  }

  if (RUN_ONCE) {
    runOnce()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(error);
        process.exit(1);
      });
  } else {
    void loop().catch((error) => {
      console.error("[watchguard-worker] exited:", error);
      process.exit(1);
    });
  }
}