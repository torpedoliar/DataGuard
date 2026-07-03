#!/usr/bin/env tsx
import fs from "node:fs";

const healthFile = process.env.HEALTH_FILE_PATH || "/tmp/dccheck-siem-alerts.health.json";
const maxStalenessMs = Number(process.env.HEALTH_MAX_STALENESS_MS || 120_000);

type HealthStatus = {
  updatedAt: string;
  lastRunAt?: string;
  lastError?: string;
  queuedTotal: number;
  sentTotal: number;
  failedTotal: number;
};

function fail(message: string): never {
  console.error(`UNHEALTHY: ${message}`);
  process.exit(1);
}

function loadStatus(): HealthStatus | null {
  try {
    const raw = fs.readFileSync(healthFile, "utf8");
    return JSON.parse(raw) as HealthStatus;
  } catch {
    return null;
  }
}

function main() {
  const status = loadStatus();
  if (!status) {
    fail(`health file not found: ${healthFile}`);
  }

  if (status.lastError) {
    console.warn(`last error: ${status.lastError}`);
  }

  const updatedAt = new Date(status.updatedAt).getTime();
  if (Number.isNaN(updatedAt)) {
    fail("invalid updatedAt timestamp");
  }

  const now = Date.now();
  if (now - updatedAt > maxStalenessMs) {
    fail(`no heartbeat for ${Math.round((now - updatedAt) / 1000)}s`);
  }

  console.log("HEALTHY");
  process.exit(0);
}

main();
