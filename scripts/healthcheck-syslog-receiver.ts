#!/usr/bin/env tsx
import fs from "node:fs";

const healthFile = process.env.HEALTH_FILE_PATH || "/tmp/dccheck-syslog-receiver.health.json";
const maxStalenessMs = Number(process.env.HEALTH_MAX_STALENESS_MS || 90_000);
const minSockets = Number(process.env.HEALTH_MIN_SOCKETS || 1);

type HealthStatus = {
  updatedAt: string;
  sockets: { transport: string; listening: boolean; address?: string }[];
  counters: { received: number; inserted: number; dropped: number; oversized: number; failed: number };
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

function checkSockets(status: HealthStatus) {
  const listening = status.sockets.filter((s) => s.listening).length;
  if (listening < minSockets) {
    fail(`only ${listening}/${minSockets} sockets listening`);
  }
}

function checkStaleness(status: HealthStatus) {
  const updatedAt = new Date(status.updatedAt).getTime();
  const now = Date.now();
  if (Number.isNaN(updatedAt)) {
    fail("invalid updatedAt timestamp");
  }
  if (now - updatedAt > maxStalenessMs) {
    fail(`no heartbeat for ${Math.round((now - updatedAt) / 1000)}s`);
  }
}

// Optional: verify the process bound ports are actually listening. The worker
// writes its bound transports into the health file; a passive listener can
// still be healthy without accepting traffic, so we only check the count here.
// Add active connect probes if TCP is enabled and localhost is reachable.
function main() {
  const status = loadStatus();
  if (!status) {
    fail(`health file not found: ${healthFile}`);
  }
  checkSockets(status);
  checkStaleness(status);
  console.log("HEALTHY");
  process.exit(0);
}

main();
