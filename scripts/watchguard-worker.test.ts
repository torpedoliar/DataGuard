import { afterEach, describe, expect, it, vi } from "vitest";

// An import must never initialize configuration, a database or production jobs.
vi.mock("dotenv/config", () => { throw new Error("unexpected env load"); });
vi.mock("@/db", () => { throw new Error("unexpected DB load"); });
vi.mock("@/lib/epdr/jobs", () => { throw new Error("unexpected live jobs load"); });

import { createWorkerRunner, runWorker } from "./watchguard-worker";

const connection = { id: 1, endpointSyncMinutes: 15, detectionSyncMinutes: 5 };
afterEach(() => vi.restoreAllMocks());

describe("WatchGuard worker orchestration (mock only)", () => {
  it("retains cadence across passes and uses fresh connection settings", async () => {
    const run = vi.fn(async () => undefined);
    const getConnections = vi.fn(async () => [connection]);
    const pass = createWorkerRunner({ jobs: [{ name: "endpoints", run }], getConnections });
    expect(await pass(0)).toEqual({ ran: 1, failed: 0 });
    expect(await pass(14 * 60_000)).toEqual({ ran: 0, failed: 0 });
    expect(await pass(15 * 60_000)).toEqual({ ran: 1, failed: 0 });
    expect(run).toHaveBeenCalledTimes(2);
    expect(getConnections).toHaveBeenCalledTimes(3);
  });

  it("retries failed jobs next pass without rerunning successful jobs", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failed = vi.fn(async () => { throw new Error("mock failure"); });
    const succeeded = vi.fn(async () => undefined);
    const pass = createWorkerRunner({
      jobs: [{ name: "endpoints", run: failed }, { name: "detections", run: succeeded }],
      getConnections: async () => [connection],
    });
    expect(await pass(0)).toEqual({ ran: 1, failed: 1 });
    expect(await pass(60_000)).toEqual({ ran: 0, failed: 1 });
    expect(failed).toHaveBeenCalledTimes(2);
    expect(succeeded).toHaveBeenCalledTimes(1);
  });

  it("actually filters --only and returns zero for a successful one-shot", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const endpoints = vi.fn(async () => undefined);
    const detections = vi.fn(async () => undefined);
    const code = await runWorker(["--run-once", "--only=endpoints"], {
      jobs: [{ name: "endpoints", run: endpoints }, { name: "detections", run: detections }],
      getConnections: async () => [connection],
    });
    expect(code).toBe(0);
    expect(endpoints).toHaveBeenCalledWith(1);
    expect(detections).not.toHaveBeenCalled();
  });

  it.each(["missing", ""])("rejects unknown/empty job %s before loading connections", async (only) => {
    const getConnections = vi.fn(async () => [connection]);
    await expect(runWorker(["--run-once", `--only=${only}`], {
      jobs: [{ name: "endpoints", run: async () => undefined }], getConnections,
    })).rejects.toThrow("Unknown worker job");
    expect(getConnections).not.toHaveBeenCalled();
  });

  it("returns nonzero for a failed job, continues other jobs and redacts errors", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const other = vi.fn(async () => undefined);
    expect(await runWorker(["--run-once"], {
      jobs: [
        { name: "endpoints", run: async () => { throw new Error("private-provider-payload"); } },
        { name: "detections", run: other },
      ],
      getConnections: async () => [connection],
    })).toBe(1);
    expect(other).toHaveBeenCalledWith(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain("private-provider-payload");
  });

  it("returns nonzero without leaking connection query errors", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await runWorker(["--run-once"], {
      jobs: [], getConnections: async () => { throw new Error("private-db-payload"); },
    })).toBe(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain("private-db-payload");
  });
});
