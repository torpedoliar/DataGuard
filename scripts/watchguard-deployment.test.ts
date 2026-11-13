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

  it("includes the worker in installation and both update service lists", () => {
    for (const script of ["deploy.sh", "update.sh"]) {
      expect(read(script)).toMatch(/^SIEM_WORKER_SERVICES=\([^\n]*\bwatchguard-worker\)/m);
      expect(read(script)).toContain('"${SIEM_WORKER_SERVICES[@]}"');
    }
    expect(read("update.ps1")).toMatch(/^\$siemWorkerServices = @\([^\n]*"watchguard-worker"\)/m);
  });

  it("tests deployment wiring in CI and refreshes source before launching the server script", () => {
    const workflow = read(".github/workflows/deploy.yml");
    expect(workflow).toContain("npx vitest run lib/backup scripts/watchguard-deployment.test.ts scripts/watchguard-worker.test.ts");
    const deploy = workflow.slice(workflow.indexOf("      - name: Run Update Script"));
    expect(deploy).toContain('git branch --show-current)" != "main"');
    expect(deploy.indexOf("git pull --ff-only origin main")).toBeGreaterThan(0);
    expect(deploy.indexOf("git pull --ff-only origin main")).toBeLessThan(deploy.indexOf("          ./update.sh"));
    expect(deploy).not.toMatch(/git (reset|stash|clean)/);
  });

  it("fails deployment if the worker is absent or restarting without exposing its environment", () => {
    const workflow = read(".github/workflows/deploy.yml");
    const verify = workflow.split("      - name: Verify WatchGuard Worker Container")[1];
    expect(verify).toBeDefined();
    expect(verify).toContain("worker=dccheck_watchguard_worker");
    expect(verify).toContain("{{.State.Status}}");
    expect(verify).toContain("{{.RestartCount}}");
    expect(verify).toContain('"$state" != "running"');
    expect(verify).toContain('"$restarts" != "0"');
    expect(verify).toContain("exit 1");
    expect(verify).not.toContain(".Config.Env");
    expect(verify).not.toMatch(/docker (exec|run|start)|watchguard:worker/);
  });
});
