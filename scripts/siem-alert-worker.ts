#!/usr/bin/env tsx
import dotenv from "dotenv";
import fs from "node:fs";
import { runSiemAlertWorkerOnce } from "../lib/siem/alerts";

dotenv.config();

const pollIntervalMs = Number(process.env.SIEM_ALERT_WORKER_POLL_INTERVAL_MS ?? 15000);
const errorSleepMs = Number(process.env.SIEM_ALERT_ERROR_SLEEP_MS ?? 5000);
const healthIntervalMs = Number(process.env.SIEM_ALERT_HEALTH_INTERVAL_MS ?? 60_000);
const healthFile = process.env.HEALTH_FILE_PATH || "/tmp/dccheck-siem-alerts.health.json";

type HealthStatus = {
  updatedAt: string;
  lastRunAt?: string;
  lastError?: string;
  queuedTotal: number;
  sentTotal: number;
  failedTotal: number;
};

let queuedTotal = 0;
let sentTotal = 0;
let failedTotal = 0;
let lastError: string | undefined;

function writeHealth(status: HealthStatus) {
  try {
    fs.writeFileSync(healthFile, JSON.stringify(status), "utf8");
  } catch (error) {
    console.error("Failed to write alerts health file", error);
  }
}

function publishHealth() {
  writeHealth({
    updatedAt: new Date().toISOString(),
    lastRunAt: new Date().toISOString(),
    lastError,
    queuedTotal,
    sentTotal,
    failedTotal,
  });
  lastError = undefined;
}

let stopping = false;

async function loop() {
  publishHealth();
  let lastHealthAt = Date.now();

  while (!stopping) {
    try {
      const result = await runSiemAlertWorkerOnce();
      queuedTotal += result.queued;
      sentTotal += result.sent;
      failedTotal += result.failed;
      if (result.queued > 0 || result.sent > 0 || result.failed > 0) {
        console.log(`SIEM alerts: ${result.queued} queued, ${result.sent} sent, ${result.failed} failed`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error("SIEM alert tick failed, retrying", error);
      await new Promise((resolve) => setTimeout(resolve, errorSleepMs));
    }

    const now = Date.now();
    if (now - lastHealthAt > healthIntervalMs) {
      publishHealth();
      console.log("siem alerts heartbeat", { queuedTotal, sentTotal, failedTotal });
      lastHealthAt = now;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

void loop().catch((error) => {
  console.error("SIEM alert worker fatal error", error);
  process.exit(1);
});

async function shutdown() {
  if (stopping) return;
  stopping = true;
  publishHealth();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => { void shutdown(); });
}
