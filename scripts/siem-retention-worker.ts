#!/usr/bin/env tsx
import dotenv from "dotenv";
import { runSiemRetentionCleanup } from "../lib/siem/retention";

dotenv.config();

const pollIntervalMs = Number(process.env.SIEM_RETENTION_WORKER_POLL_INTERVAL_MS ?? 60 * 60 * 1000);
const batchSize = Number(process.env.SIEM_RETENTION_BATCH_SIZE ?? 1000);
const runOnce = process.argv.includes("--run-once");

async function executeCleanup() {
  const result = await runSiemRetentionCleanup({ batchSize });
  console.log(
    `SIEM retention cleanup completed at ${new Date().toISOString()}: ${result.rawEventsDeleted} raw, ${result.eventsDeleted} events, ${result.findingsDeleted} findings, ${result.alertsDeleted} alerts deleted; ` +
    `${result.evidenceArchivedFindings} findings archived; partitions +${result.partitionsCreated}/-${result.partitionsDropped}`,
  );
  return result;
}

async function loop() {
  console.log(`SIEM retention worker started. Polling every ${pollIntervalMs / 1000 / 60} minutes.`);
  while (true) {
    await executeCleanup().catch((error) => console.error("SIEM retention cycle failed", error));
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

if (runOnce) {
  executeCleanup()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("SIEM retention run-once failed", error);
      process.exit(1);
    });
} else {
  void loop().catch((error) => {
    console.error("SIEM retention worker failed", error);
    process.exit(1);
  });
}

