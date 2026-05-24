#!/usr/bin/env tsx
import dotenv from "dotenv";
import { runSiemRetentionCleanup } from "../lib/siem/retention";

dotenv.config();

const pollIntervalMs = Number(process.env.SIEM_RETENTION_WORKER_POLL_INTERVAL_MS ?? 60 * 60 * 1000);
const batchSize = Number(process.env.SIEM_RETENTION_BATCH_SIZE ?? 1000);

async function loop() {
  while (true) {
    const result = await runSiemRetentionCleanup({ batchSize });
    const total = result.rawEventsDeleted + result.eventsDeleted + result.findingsDeleted + result.alertsDeleted;
    if (total > 0) {
      console.log(`SIEM retention: ${result.rawEventsDeleted} raw, ${result.eventsDeleted} events, ${result.findingsDeleted} findings, ${result.alertsDeleted} alerts deleted`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

void loop().catch((error) => {
  console.error("SIEM retention worker failed", error);
  process.exit(1);
});
