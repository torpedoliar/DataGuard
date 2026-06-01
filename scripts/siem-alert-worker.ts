#!/usr/bin/env tsx
import dotenv from "dotenv";
import { runSiemAlertWorkerOnce } from "../lib/siem/alerts";

dotenv.config();

const pollIntervalMs = Number(process.env.SIEM_ALERT_WORKER_POLL_INTERVAL_MS ?? 15000);

async function loop() {
  while (true) {
    const result = await runSiemAlertWorkerOnce();
    if (result.queued > 0 || result.sent > 0 || result.failed > 0) console.log(`SIEM alerts: ${result.queued} queued, ${result.sent} sent, ${result.failed} failed`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

void loop().catch((error) => {
  console.error("SIEM alert worker failed", error);
  process.exit(1);
});
