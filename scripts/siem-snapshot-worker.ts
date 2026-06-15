#!/usr/bin/env tsx
import dotenv from "dotenv";
import { captureSiemSnapshot } from "../lib/siem/snapshots";

dotenv.config();

const pollIntervalMs = Number(
  process.env.SIEM_SNAPSHOT_WORKER_POLL_INTERVAL_MS ?? 60 * 60 * 1000,
);

async function loop() {
  // Run once at startup so the dashboard has at least one history point
  // immediately after the worker is deployed.
  try {
    const first = await captureSiemSnapshot();
    console.log(
      `SIEM snapshot captured at ${first.capturedAt.toISOString()} ` +
        `(raw24h=${first.counters.raw24h}, open=${first.counters.openFindings})`,
    );
  } catch (error) {
    console.error("SIEM snapshot worker initial capture failed", error);
  }

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    try {
      const result = await captureSiemSnapshot();
      console.log(
        `SIEM snapshot captured at ${result.capturedAt.toISOString()} ` +
          `(raw24h=${result.counters.raw24h}, open=${result.counters.openFindings})`,
      );
    } catch (error) {
      console.error("SIEM snapshot worker iteration failed", error);
    }
  }
}

void loop().catch((error) => {
  console.error("SIEM snapshot worker failed", error);
  process.exit(1);
});
