import { describe, expect, it, vi } from "vitest";
import { mergeEndpoints, syncEndpoints, type EndpointSyncDeps, type EndpointSourceDevice, type EndpointSourceProtection } from "./sync";

const devices: EndpointSourceDevice[] = [
  { device_id: "d-1", host_name: "WS-1", device_type: 1, ip_address: "10.0.0.1" },
  { device_id: "d-2", host_name: "SRV-1", device_type: 3, ip_address: "10.0.0.2" },
];

const protections: EndpointSourceProtection[] = [
  { device_id: "d-1", accumulated_protection_status: 1, reboot_requested: false },
  { device_id: "d-2", accumulated_protection_status: 3, reboot_requested: true },
];

describe("mergeEndpoints", () => {
  it("merges protection status onto device rows by device_id", () => {
    const merged = mergeEndpoints(devices, protections);
    expect(merged).toHaveLength(2);
    const ws = merged.find((m) => m.wgDeviceId === "d-1")!;
    expect(ws.accumulatedProtectionStatus).toBe(1);
    expect(ws.hostName).toBe("WS-1");
    const srv = merged.find((m) => m.wgDeviceId === "d-2")!;
    expect(srv.accumulatedProtectionStatus).toBe(3);
    expect(srv.rebootRequested).toBe(true);
  });

  it("skips devices without a device_id and tolerates missing protection rows", () => {
    const merged = mergeEndpoints([{ host_name: "no-id" }], []);
    expect(merged).toHaveLength(0);
    const one = mergeEndpoints(devices, []);
    expect(one[0]!.accumulatedProtectionStatus).toBeNull();
  });
});

function makeDeps(overrides: Partial<EndpointSyncDeps> = {}): {
  deps: EndpointSyncDeps;
  upserted: Array<unknown>;
  removedIds: string[][];
} {
  const upserted: Array<unknown> = [] as Array<unknown>;
  const removedIds: string[][] = [];
  const deps: EndpointSyncDeps = {
    connectionId: 1,
    siteId: 1,
    tryAcquireLock: vi.fn(async () => true),
    releaseLock: vi.fn(async () => undefined),
    iterateDevices: async function* () {
      for (const d of devices) yield d;
    },
    iterateProtectionStatus: async function* () {
      for (const p of protections) yield p;
    },
    listUnmanagedDevices: vi.fn(async () => []),
    existingDeviceIds: vi.fn(async () => new Set<string>()),
    upsertEndpoint: vi.fn(async (_c, _s, merged) => { upserted.push(merged); }),
    markRemoved: vi.fn(async (_c, absentIds: string[]) => { removedIds.push(absentIds); return absentIds.length; }),
    upsertUnmanaged: vi.fn(async () => 0),
    recordSyncRun: vi.fn(async () => undefined),
    touchConnection: vi.fn(async () => undefined),
    ...overrides,
  };
  return { deps, upserted, removedIds };
}

describe("syncEndpoints", () => {
  it("creates/updates endpoint rows and clears removal when device ids reappear", async () => {
    const { deps, upserted } = makeDeps({ existingDeviceIds: vi.fn(async () => new Set(["d-1"])) });
    const result = await syncEndpoints(deps);
    expect(result.status).toBe("ok");
    expect(upserted).toHaveLength(2);
    // d-1 still present → not removed; d-2 never existed → not marked absent.
    expect(deps.markRemoved).not.toHaveBeenCalled();
  });

  it("marks a previously-seen device removed when absent from a complete fetch", async () => {
    const { deps, removedIds } = makeDeps({ existingDeviceIds: vi.fn(async () => new Set(["d-1", "d-9"])) });
    const result = await syncEndpoints(deps);
    expect(result.status).toBe("ok");
    expect(removedIds).toEqual([["d-9"]]);
  });

  it("never marks removal on a partial fetch", async () => {
    const { deps } = makeDeps({
      existingDeviceIds: vi.fn(async () => new Set(["d-1", "d-9"])),
      iterateDevices: async function* () {
        yield devices[0]!;
        throw new Error("page failed");
      },
    });
    const result = await syncEndpoints(deps);
    expect(result.status).toBe("partial");
    expect(deps.markRemoved).not.toHaveBeenCalled();
  });

  it("records skipped_locked and does no work when the lock is busy", async () => {
    const { deps, upserted } = makeDeps({ tryAcquireLock: vi.fn(async () => false) });
    const result = await syncEndpoints(deps);
    expect(result.status).toBe("skipped_locked");
    expect(upserted).toHaveLength(0);
    expect(deps.upsertEndpoint).not.toHaveBeenCalled();
  });

  it("records a successful empty inventory rather than remaining in first sync", async () => {
    const { deps } = makeDeps({ iterateDevices: async function* () {}, iterateProtectionStatus: async function* () {} });
    expect((await syncEndpoints(deps)).status).toBe("ok");
    expect(deps.touchConnection).toHaveBeenCalledWith(1, undefined);
  });

  it("records safe partial errors rather than advancing successful freshness", async () => {
    const { deps } = makeDeps({ iterateDevices: async function* () { throw new Error("private-password"); } });
    const result = await syncEndpoints(deps);
    expect(result.status).toBe("partial");
    expect(result.error).toBe("devices:internal_error");
    expect(deps.touchConnection).toHaveBeenCalledWith(1, "devices:internal_error");
    expect(JSON.stringify(result)).not.toContain("private-password");
  });

  it("distinguishes lock infrastructure failures from contention", async () => {
    const { deps } = makeDeps({ tryAcquireLock: vi.fn(async () => { throw new Error("private-database-url"); }) });
    expect(await syncEndpoints(deps)).toMatchObject({ status: "failed", error: "endpoint_sync:internal_error" });
    expect(deps.touchConnection).toHaveBeenCalledWith(1, "endpoint_sync:internal_error");
    expect(deps.releaseLock).not.toHaveBeenCalled();
  });

  it("records safe persistence failures and releases an acquired lock", async () => {
    const { deps } = makeDeps({ upsertEndpoint: vi.fn(async () => { throw new Error("private-query"); }) });
    expect((await syncEndpoints(deps)).status).toBe("failed");
    expect(deps.touchConnection).toHaveBeenCalledWith(1, "endpoint_sync:internal_error");
    expect(deps.releaseLock).toHaveBeenCalledWith(1);
  });

  it("is idempotent: a rerun upserts the same rows without duplicates", async () => {
    const { deps, upserted } = makeDeps();
    await syncEndpoints(deps);
    await syncEndpoints(deps);
    expect(upserted).toHaveLength(4); // two deterministic passes, DB upserts dedup by unique key
  });
});