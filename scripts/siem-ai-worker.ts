#!/usr/bin/env tsx
import dotenv from "dotenv";
import { runSiemAiWorkerOnce } from "../lib/siem/ai-queue";

dotenv.config();

const pollIntervalMs = Number(process.env.SIEM_AI_WORKER_POLL_INTERVAL_MS ?? 30000);

async function loop() {
  while (true) {
    const result = await runSiemAiWorkerOnce();
    if (result.processed > 0) console.log(`SIEM AI: ${result.processed} processed, ${result.completed} completed, ${result.failed} failed`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

void loop().catch((error) => {
  console.error("SIEM AI worker failed", error);
  process.exit(1);
});
