import { describe, expect, it, vi } from "vitest";
import {
  dedupeKeyOf,
  ncmIngestSchema,
  processNcmEvent,
  resolveDeviceId,
  resolveSeverity,
  verifyNcmSignature,
  type NcmIngestDeps,
} from "./ncm-ingest";

// ===== HMAC (vector generated with the NCM sender's own algorithm:
// python hmac.new(secret, body, sha256).hexdigest(), app_v4/service/notify.py) =====

const RAW_BODY =
  '{"type":"backup_failed","payload":{"switch_id":7,"switch_name":"SW-CORE-01","backup_id":42,"message":"timeout"},"ts":"2026-09-09T00:00:00Z"}';
const SECRET = "whsec_ticket06_test";
const VALID_SIGNATURE =
  "sha256=a04b29a69cc66469305f00574bb9079219301db71a9a10325c8d4369bfbc02fd";

describe("verifyNcmSignature", () => {
  it("accepts a valid sha256= signature", () => {
    expect(verifyNcmSignature(RAW_BODY, VALID_SIGNATURE, SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyNcmSignature(RAW_BODY + " ", VALID_SIGNATURE, SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyNcmSignature(RAW_BODY, VALID_SIGNATURE, "other")).toBe(false);
  });

  it("rejects malformed headers (no sha256= prefix, wrong hex, empty)", () => {
    expect(verifyNcmSignature(RAW_BODY, VALID_SIGNATURE.slice(7), SECRET)).toBe(false);
    expect(verifyNcmSignature(RAW_BODY, "sha256=zzzz", SECRET)).toBe(false);
    expect(verifyNcmSignature(RAW_BODY, null, SECRET)).toBe(false);
    expect(verifyNcmSignature(RAW_BODY, "", SECRET)).toBe(false);
  });

  it("rejects an empty secret (fail closed)", () => {
    expect(verifyNcmSignature(RAW_BODY, VALID_SIGNATURE, "")).toBe(false);
  });
});

describe("ncmIngestSchema", () => {
  it("parses the exact NCM envelope shape", () => {
    const parsed = ncmIngestSchema.parse(JSON.parse(RAW_BODY));
    expect(parsed.type).toBe("backup_failed");
    expect(parsed.payload.switch_name).toBe("SW-CORE-01");
    expect(parsed.payload.switch_id).toBe(7);
  });

  it("accepts review_decided with status/comment and optional top-level id", () => {
    const parsed = ncmIngestSchema.parse({
      id: "evt-123",
      type: "review_decided",
      payload: { review_id: 5, switch_id: 7, status: "approved", comment: "ok" },
      ts: "2026-09-09T00:00:00Z",
    });
    expect(parsed.payload.status).toBe("approved");
    expect(parsed.id).toBe("evt-123");
  });

  it("rejects unknown event types and non-object payloads", () => {
    expect(() =>
      ncmIngestSchema.parse({ type: "hacked", payload: {}, ts: "t" }),
    ).toThrow();
    expect(() =>
      ncmIngestSchema.parse({ type: "drift", payload: "nope", ts: "t" }),
    ).toThrow();
  });
});

describe("resolveSeverity", () => {
  it("maps backup_failed and device_offline to High, drift to Medium", () => {
    expect(resolveSeverity("backup_failed")).toBe("High");
    expect(resolveSeverity("device_offline")).toBe("High");
    expect(resolveSeverity("drift")).toBe("Medium");
  });
});

describe("dedupeKeyOf", () => {
  it("uses the event id when present", () => {
    expect(dedupeKeyOf({ id: "evt-1" } as never)).toBe("evt-1");
  });

  it("is deterministic without an id (same event → same key, different event → different)", () => {
    const a = dedupeKeyOf({
      type: "backup_failed",
      payload: { switch_id: 7, backup_id: 42 },
      ts: "t1",
    } as never);
    const b = dedupeKeyOf({
      type: "backup_failed",
      payload: { switch_id: 7, backup_id: 42 },
      ts: "t2-different",
    } as never);
    const c = dedupeKeyOf({
      type: "backup_failed",
      payload: { switch_id: 7, backup_id: 43 },
      ts: "t1",
    } as never);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("resolveDeviceId", () => {
  const makeDeps = (devices: { id: number; name: string }[]): Pick<NcmIngestDeps, "findDevicesBySite"> => ({
    findDevicesBySite: vi.fn().mockResolvedValue(devices),
  });

  it("matches a device by exact or case-insensitive name", async () => {
    const deps = makeDeps([
      { id: 1, name: "RTR-EDGE" },
      { id: 2, name: "sw-core-01" },
    ]);
    await expect(resolveDeviceId(deps, 10, "SW-CORE-01")).resolves.toBe(2);
  });

  it("falls back to the first device of the site", async () => {
    const deps = makeDeps([{ id: 9, name: "OTHER" }]);
    await expect(resolveDeviceId(deps, 10, "NOPE")).resolves.toBe(9);
  });

  it("returns null when the site has no devices", async () => {
    const deps = makeDeps([]);
    await expect(resolveDeviceId(deps, 10, "ANY")).resolves.toBeNull();
  });
});

// ===== processNcmEvent (fake deps, no Postgres) =====

type IncidentRow = {
  id: number;
  siteId: number;
  deviceId: number;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  resolvedAt: Date | null;
};

function makeDeps(overrides: Partial<NcmIngestDeps> = {}): {
  deps: NcmIngestDeps;
  inserted: { incidents: unknown[]; updates: unknown[] };
  resolved: { id: number; note: string }[];
} {
  const inserted = { incidents: [] as unknown[], updates: [] as unknown[] };
  const resolved: { id: number; note: string }[] = [];
  let nextId = 100;
  const deps: NcmIngestDeps = {
    findDevicesBySite: vi.fn().mockResolvedValue([{ id: 9, name: "SW-CORE-01" }]),
    findOpenIncidentByMarker: vi.fn().mockResolvedValue(null),
    findOpenBackupFailedIncident: vi.fn().mockResolvedValue(null),
    findOpenDriftIncident: vi.fn().mockResolvedValue(null),
    insertIncident: vi.fn().mockImplementation(async (values: {
      title: string;
      severity: string;
      description?: string | null;
    }) => {
      const row: IncidentRow = {
        id: nextId++,
        siteId: 0,
        deviceId: 0,
        title: values.title,
        description: values.description ?? null,
        severity: values.severity,
        status: "Open",
        resolvedAt: null,
      };
      inserted.incidents.push(row);
      return row as never;
    }),
    insertIncidentUpdate: vi.fn().mockImplementation(async (values: unknown) => {
      inserted.updates.push(values);
    }),
    resolveIncident: vi.fn().mockImplementation(async (id: number, note: string) => {
      resolved.push({ id, note });
    }),
    ...overrides,
  } as NcmIngestDeps;
  return { deps, inserted, resolved };
}

describe("processNcmEvent", () => {
  const event = (type: string, payload: Record<string, unknown>, id?: string) =>
    ncmIngestSchema.parse({ ...(id ? { id } : {}), type, payload, ts: "2026-09-09T00:00:00Z" });

  it("creates a High incident for backup_failed and returns telegram actions", async () => {
    const { deps, inserted } = makeDeps();
    const result = await processNcmEvent(deps, {
      siteId: 10,
      siteName: "DC-JKT",
      event: event("backup_failed", { switch_id: 7, switch_name: "SW-CORE-01", backup_id: 42, message: "timeout" }),
    });
    expect(inserted.incidents).toHaveLength(1);
    expect((inserted.incidents[0] as IncidentRow).severity).toBe("High");
    expect((inserted.incidents[0] as IncidentRow).title).toContain("SW-CORE-01");
    expect(result.actions).toEqual([
      { kind: "created", incidentId: 100, severity: "High" },
    ]);
  });

  it("dedupes by marker: an already-processed event is a no-op", async () => {
    const { deps, inserted } = makeDeps({
      findOpenIncidentByMarker: vi.fn().mockResolvedValue({ id: 55 }),
    });
    const result = await processNcmEvent(deps, {
      siteId: 10,
      siteName: "DC-JKT",
      event: event("backup_failed", { switch_id: 7, switch_name: "X", backup_id: 1 }),
    });
    expect(inserted.incidents).toHaveLength(0);
    expect(result.actions).toEqual([]);
  });

  it("backup_ok auto-resolves the open backup_failed incident of the same switch", async () => {
    const { deps, resolved, inserted } = makeDeps({
      findOpenBackupFailedIncident: vi.fn().mockResolvedValue({ id: 77, title: "Backup failed: X" }),
    });
    const result = await processNcmEvent(deps, {
      siteId: 10,
      siteName: "DC-JKT",
      event: event("backup_ok", { switch_id: 7, switch_name: "SW-CORE-01", backup_id: 43 }),
    });
    expect(inserted.incidents).toHaveLength(0);
    expect(resolved).toEqual([{ id: 77, note: expect.stringContaining("backup_ok") }]);
    expect(result.actions).toEqual([{ kind: "resolved", incidentId: 77, severity: null }]);
  });

  it("review_decided approved auto-resolves the open drift incident", async () => {
    const { deps, resolved, inserted } = makeDeps({
      findOpenDriftIncident: vi.fn().mockResolvedValue({ id: 88, title: "Config drift: X" }),
    });
    const result = await processNcmEvent(deps, {
      siteId: 10,
      siteName: "DC-JKT",
      event: event("review_decided", { review_id: 5, switch_id: 7, status: "approved", comment: "CR-1" }),
    });
    expect(inserted.incidents).toHaveLength(0);
    expect(resolved).toEqual([{ id: 88, note: expect.stringContaining("approved") }]);
    expect(result.actions).toEqual([{ kind: "resolved", incidentId: 88, severity: null }]);
  });

  it("review_decided with a non-approved status does nothing (policy: incidents stay)", async () => {
    const { deps, inserted, resolved } = makeDeps();
    const result = await processNcmEvent(deps, {
      siteId: 10,
      siteName: "DC-JKT",
      event: event("review_decided", { review_id: 5, switch_id: 7, status: "flagged" }),
    });
    expect(inserted.incidents).toHaveLength(0);
    expect(resolved).toEqual([]);
    expect(result.actions).toEqual([]);
  });

  it("drift creates a Medium incident", async () => {
    const { deps, inserted } = makeDeps();
    await processNcmEvent(deps, {
      siteId: 10,
      siteName: "DC-JKT",
      event: event("drift", { switch_id: 7, switch_name: "SW-CORE-01", backup_id: 42, review_id: 5 }),
    });
    expect((inserted.incidents[0] as IncidentRow).severity).toBe("Medium");
    expect((inserted.incidents[0] as IncidentRow).title).toContain("drift");
  });

  it("records an ncm_event_id marker on the created incident", async () => {
    const { deps, inserted } = makeDeps();
    await processNcmEvent(deps, {
      siteId: 10,
      siteName: "DC-JKT",
      event: event("backup_failed", { switch_id: 7, switch_name: "SW-CORE-01", backup_id: 42 }, "evt-9"),
    });
    expect((inserted.incidents[0] as IncidentRow).description).toContain("ncm_event_id:evt-9");
  });

  it("returns null device mapping when the site has no devices (route answers 503)", async () => {
    const { deps, inserted } = makeDeps({
      findDevicesBySite: vi.fn().mockResolvedValue([]),
    });
    const result = await processNcmEvent(deps, {
      siteId: 10,
      siteName: "DC-JKT",
      event: event("backup_failed", { switch_id: 7, switch_name: "SW-CORE-01", backup_id: 42 }),
    });
    expect(result.deviceId).toBeNull();
    expect(inserted.incidents).toHaveLength(0);
  });
});
