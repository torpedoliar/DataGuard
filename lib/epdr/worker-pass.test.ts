import { describe, expect, it, vi } from "vitest";
import { resolveJobIntervalMinutes, runWorkerPass, shouldRunJob } from "@/lib/epdr/worker-pass";

const conn = { id: 1, endpointSyncMinutes: 15, detectionSyncMinutes: 5 };

describe("resolveJobIntervalMinutes / shouldRunJob", () => {
  it("uses endpoint cadence for the endpoints job and detection cadence otherwise", () => {
    expect(resolveJobIntervalMinutes("endpoints", conn)).toBe(15);
    expect(resolveJobIntervalMinutes("detections", conn)).toBe(5);
  });

  it("runs a job when last run is null, and gates by interval otherwise", () => {
    expect(shouldRunJob("endpoints", conn, { nowMs: 0, lastRunMs: null })).toBe(true);
    const interval = 15 * 60 * 1000;
    expect(shouldRunJob("endpoints", conn, { nowMs: interval, lastRunMs: 0 })).toBe(true);
    expect(shouldRunJob("endpoints", conn, { nowMs: interval - 1, lastRunMs: 0 })).toBe(false);
  });
});

describe("runWorkerPass", () => {
  it("does not abort the remaining connections when one job throws", async () => {
    const lastRun = new Map<string, number>();
    const runJob = vi.fn(async (name: string, connectionId: number) => {
      if (connectionId === 1) throw new Error("site down");
    });
    const connections = [
      { id: 1, endpointSyncMinutes: 15, detectionSyncMinutes: 5 },
      { id: 2, endpointSyncMinutes: 15, detectionSyncMinutes: 5 },
    ];
    const result = await runWorkerPass(connections, [{ name: "endpoints" }], lastRun, runJob, 1_000_000);
    expect(runJob).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ran: 1, failed: 1 });
  });

  it("selects jobs by interval and skips not-due jobs", async () => {
    const lastRun = new Map<string, number>([["1:endpoints", 0]]);
    const runJob = vi.fn(async () => undefined);
    // 14 minutes < 15-minute interval → skipped.
    const result = await runWorkerPass([conn], [{ name: "endpoints" }], lastRun, runJob, 14 * 60 * 1000);
    expect(runJob).not.toHaveBeenCalled();
    expect(result).toEqual({ ran: 0, failed: 0 });
  });
});