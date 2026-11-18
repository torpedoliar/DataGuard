#!/usr/bin/env tsx
/**
 * EPDR execution retention worker.
 *
 * Deletes attempts of terminal provider-write actions after the per-site
 * attempt window and redacts result/response payloads after the result
 * window. Actions, snapshots and approval records are permanent. Each pass is
 * bounded and lock-skipping, so it never blocks dispatch.
 */
import dotenv from "dotenv";
import { runExecutionRetention } from "../lib/epdr/retention";

dotenv.config();

const pollIntervalMs = Number(process.env.EPDR_RETENTION_WORKER_POLL_INTERVAL_MS ?? 60 * 60 * 1000);
const batchSize = Number(process.env.EPDR_RETENTION_BATCH_SIZE ?? 500);
const runOnce = process.argv.includes("--run-once");

async function executeCleanup() {
  const result = await runExecutionRetention({ batchSize });
  console.log(
    `EPDR execution retention completed at ${new Date().toISOString()}: ` +
    `${result.deletedAttempts} attempts deleted, ${result.redactedResults} results redacted, ${result.redactedResponses} responses redacted`,
  );
  return result;
}

async function loop() {
  console.log(`EPDR retention worker started. Polling every ${pollIntervalMs / 1000 / 60} minutes.`);
  while (true) {
    await executeCleanup().catch(() => console.error("EPDR retention cycle failed"));
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

if (runOnce) {
  executeCleanup()
    .then(() => process.exit(0))
    .catch(() => {
      console.error("EPDR retention run-once failed");
      process.exit(1);
    });
} else {
  void loop().catch(() => {
    console.error("EPDR retention worker failed");
    process.exit(1);
  });
}
