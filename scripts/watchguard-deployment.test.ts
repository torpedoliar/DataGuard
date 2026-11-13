import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("WatchGuard deployment wiring (static checks only)", () => {
  it("reuses the archived application runtime without a web healthcheck", () => {
    const service = read("docker-compose.yml").split("  watchguard-worker:\n")[1]?.split("\n  db:")[0];
    expect(service).toBeDefined();
    expect(service).toContain("image: dc-check-app:latest");
    expect(service).toContain("command: npm run watchguard:worker");
    expect(service).toContain("restart: unless-stopped");
    expect(service).toContain("env_file:\n      - .env");
    expect(service).toContain("app:\n        condition: service_healthy");
    expect(service).toContain("healthcheck:\n      disable: true");
    expect(service).toContain("- dccheck_net");
    expect(service).not.toContain("ports:");
    expect(read("Dockerfile")).toMatch(/tar -cf \/app\/assets\.tar .*package\.json .*scripts lib node_modules/);
    expect(JSON.parse(read("package.json")).scripts["watchguard:worker"]).toBe("tsx scripts/watchguard-worker.ts");
  });

  it("includes the worker in both update service lists", () => {
    expect(read("update.sh")).toMatch(/^SIEM_WORKER_SERVICES=\([^\n]*\bwatchguard-worker\)/m);
    expect(read("update.ps1")).toMatch(/^\$siemWorkerServices = @\([^\n]*"watchguard-worker"\)/m);
  });
});
