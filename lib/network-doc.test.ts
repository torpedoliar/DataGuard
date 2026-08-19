import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  insertValues: [] as unknown[],
  insertReturning: [] as unknown[][],
  updateSets: [] as unknown[],
  deleteCalled: 0,
}));

vi.mock("../db", () => {
  const select = () => ({
    from: () => ({
      where: () => ({
        then: (onFulfilled: (value: unknown[]) => unknown) => {
          const result = mocks.selectResults.shift();
          return Promise.resolve(result ?? []).then(onFulfilled);
        },
      }),
    }),
  });

  const insert = () => ({
    values: (value: unknown) => {
      mocks.insertValues.push(value);
      return {
        returning: () => {
          const result = mocks.insertReturning.length > 0 ? mocks.insertReturning.shift() : [];
          return Promise.resolve(result);
        },
      };
    },
  });

  const update = () => ({
    set: (set: unknown) => {
      mocks.updateSets.push(set);
      return {
        where: () => Promise.resolve(undefined),
      };
    },
  });

  return {
    db: {
      select,
      insert,
      update,
      delete: () => ({ where: () => { mocks.deleteCalled++; return Promise.resolve(undefined); } }),
    },
  };
});

import { fetchNetworkDoc, syncNetworkDocs } from "./network-doc";

const API_URL = "http://10.0.0.9:8443";
const API_KEY = "ncr-test-key";

// Live-shape fixture (verified against the real API on 2026-08-19).
const SWITCH_A = {
  switch_id: 1,
  name: "10.10.0.50",
  ip: "10.10.0.50",
  protocol: "websmart-v2",
  hostname: "LAB I-2",
  source_backup_id: 2,
  backup_taken_at: "2026-08-19T04:44:41.878337Z",
  vlans: [
    { id: 88, name: "IPH-DEVICE" },
    { id: 11, name: "MGMT" },
  ],
  ports: [
    { name: "port1.0.1", description: "uplink", enabled: true, mode: "trunk", native_vlan: 11, access_vlan: null, trunk_allowed_vlans: [88, 11] },
    { name: "port1.0.2", description: "", enabled: false, mode: "access", native_vlan: null, access_vlan: 88, trunk_allowed_vlans: [] },
    { name: "port1.0.3", description: "odd", enabled: true, mode: "weird", native_vlan: 999, access_vlan: null, trunk_allowed_vlans: [] },
  ],
  parse_warnings: [],
};

function stubFetch(payload: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => "unauthorized",
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubEnv(overrides: Record<string, string | undefined>) {
  vi.stubEnv("NETWORK_DOC_URL", overrides.NETWORK_DOC_URL ?? API_URL);
  vi.stubEnv("NETWORK_DOC_API_KEY", overrides.NETWORK_DOC_API_KEY ?? API_KEY);
  vi.stubEnv("NETWORK_DOC_SITE_ID", "7");
}

const DEVICE_IP = { id: 10, name: "10.10.0.50", assetCode: null, ipAddress: "10.10.0.50" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectResults.length = 0;
  mocks.insertValues.length = 0;
  mocks.insertReturning.length = 0;
  mocks.updateSets.length = 0;
  mocks.deleteCalled = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetchNetworkDoc", () => {
  it("sends the API key header and a timeout, and hits /api/v1/network-doc", async () => {
    const fetchMock = stubFetch([SWITCH_A]);

    const result = await fetchNetworkDoc(API_URL + "/", API_KEY);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_URL}/api/v1/network-doc`);
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe(API_KEY);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toHaveLength(1);
  });

  it("throws on a non-OK response with the status", async () => {
    stubFetch([], false, 401);
    await expect(fetchNetworkDoc(API_URL, API_KEY)).rejects.toThrow("401");
  });

  it("tolerates parse_warnings and returns the switches", async () => {
    stubFetch([{ ...SWITCH_A, parse_warnings: ["no successful backup"] }]);
    const result = await fetchNetworkDoc(API_URL, API_KEY);
    expect(result[0].parse_warnings).toEqual(["no successful backup"]);
  });

  it("accepts a { data: [...] } envelope as a lenient fallback", async () => {
    stubFetch({ data: [SWITCH_A] });
    const result = await fetchNetworkDoc(API_URL, API_KEY);
    expect(result).toHaveLength(1);
  });
});

describe("syncNetworkDocs", () => {
  it("returns a not-configured summary without calling the API when env is missing", async () => {
    stubEnv({ NETWORK_DOC_URL: "", NETWORK_DOC_API_KEY: "" });
    const fetchMock = stubFetch([SWITCH_A]);

    const summary = await syncNetworkDocs(7);

    expect(summary.switchesTotal).toBe(0);
    expect(summary.warnings.some((w) => w.includes("not configured"))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("matches by IP, upserts vlans BEFORE ports, maps access/trunk fields, warns on odd data", async () => {
    stubEnv({});
    stubFetch([SWITCH_A]);
    // site context: 1 device matched by IP, no existing vlans, no ports
    mocks.selectResults.push([DEVICE_IP], [], []);
    // vlan inserts return ids in insertion order
    mocks.insertReturning.push([{ id: 100 }], [{ id: 101 }]);

    const summary = await syncNetworkDocs(7);

    expect(summary).toMatchObject({
      switchesTotal: 1, switchesMatched: 1, switchesUnmatched: 0,
      vlansCreated: 2, vlansUpdated: 0, portsCreated: 3, portsUpdated: 0,
    });

    // vlans first (inserts 0-1), then ports (inserts 2+)
    const vlanInserts = mocks.insertValues.slice(0, 2) as Record<string, unknown>[];
    expect(vlanInserts[0]).toMatchObject({ siteId: 7, vlanId: 88, name: "IPH-DEVICE" });
    expect(vlanInserts[1]).toMatchObject({ siteId: 7, vlanId: 11, name: "MGMT" });

    const portInserts = mocks.insertValues.slice(2) as Record<string, unknown>[];
    // trunk port: PVID from native_vlan (map 11 -> 101), allowed list as CSV
    expect(portInserts[0]).toMatchObject({
      deviceId: 10, portName: "port1.0.1", portMode: "Trunk", vlanId: 101,
      trunkVlans: "88, 11", status: "Active", description: "uplink",
    });
    // access port: PVID from access_vlan (map 88 -> 100), disabled -> Inactive
    expect(portInserts[1]).toMatchObject({
      deviceId: 10, portName: "port1.0.2", portMode: "Access", vlanId: 100,
      trunkVlans: null, status: "Inactive", description: null,
    });
    // odd mode + vlan 999 absent on site -> unset + warnings
    expect(portInserts[2]).toMatchObject({
      deviceId: 10, portName: "port1.0.3", portMode: null, vlanId: null,
    });
    expect(summary.warnings.some((w) => w.includes('unknown mode "weird"'))).toBe(true);
    expect(summary.warnings.some((w) => w.includes("vlan 999 not present"))).toBe(true);
  });

  it("falls back to name (case-insensitive), hostname, then assetCode", async () => {
    stubEnv({});
    stubFetch([
      { ...SWITCH_A, name: "10.10.0.50", ip: null },                    // -> device 10 by name
      { ...SWITCH_A, switch_id: 2, name: "ignored", ip: null, hostname: "LAB I-2" }, // -> device 11 by hostname
      { ...SWITCH_A, switch_id: 3, name: "OTHER", ip: null, hostname: null },        // -> device 12 by assetCode
    ]);
    mocks.selectResults.push(
      [
        { id: 10, name: "10.10.0.50", assetCode: null, ipAddress: null },
        { id: 11, name: "lab i-2", assetCode: null, ipAddress: null },
        { id: 12, name: "whatever", assetCode: "OTHER", ipAddress: null },
      ],
      [],
      [],
    );
    mocks.insertReturning.push([{ id: 100 }], [{ id: 101 }]);

    const summary = await syncNetworkDocs(7);

    expect(summary.switchesMatched).toBe(3);
    expect(summary.switchesUnmatched).toBe(0);
    const portInserts = mocks.insertValues.slice(2) as Record<string, unknown>[];
    expect(portInserts).toHaveLength(9);
    expect(new Set(portInserts.map((p) => p.deviceId))).toEqual(new Set([10, 11, 12]));
  });

  it("counts an unmatched switch and warns", async () => {
    stubEnv({});
    stubFetch([SWITCH_A]);
    mocks.selectResults.push([], [], []); // no devices in site

    const summary = await syncNetworkDocs(7);

    expect(summary.switchesMatched).toBe(0);
    expect(summary.switchesUnmatched).toBe(1);
    expect(summary.warnings.some((w) => w.includes("not matched to a device"))).toBe(true);
  });

  it("updates only API-provided fields, never touches MAC/speed/cabling, never deletes", async () => {
    stubEnv({});
    stubFetch([SWITCH_A]);
    mocks.selectResults.push(
      [DEVICE_IP],
      [{ id: 100, vlanId: 88, name: "IPH-DEVICE" }, { id: 101, vlanId: 11, name: "MGMT" }],
      // existing ports: port1.0.1 (to be updated) + port1.0.9 (absent from doc — must survive)
      [
        {
          id: 500, deviceId: 10, portName: "port1.0.1", portMode: "Access", vlanId: null,
          trunkVlans: null, status: "Active", description: "old desc",
          macAddress: "aa:bb:cc", speed: "1G", portIndex: 3, connectedToDeviceId: 7, connectedToPortId: 9,
        },
        { id: 501, deviceId: 10, portName: "port1.0.9", portMode: null, vlanId: null, trunkVlans: null, status: "Active", description: null },
      ],
    );

    const summary = await syncNetworkDocs(7);

    // port1.0.9 absent from doc: no delete issued
    expect(mocks.deleteCalled).toBe(0);
    // vlan 88/11 already exist with same names -> no vlan updates
    expect(summary.vlansCreated).toBe(0);
    expect(summary.vlansUpdated).toBe(0);
    // only the changed API fields are written
    expect(mocks.updateSets).toHaveLength(1);
    const update = mocks.updateSets[0] as Record<string, unknown>;
    expect(update).toMatchObject({ portMode: "Trunk", vlanId: 101, trunkVlans: "88, 11", description: "uplink" });
    expect(update.status).toBeUndefined(); // already Active, doc says enabled
    expect(update).not.toHaveProperty("macAddress");
    expect(update).not.toHaveProperty("speed");
    expect(update).not.toHaveProperty("portIndex");
    expect(update).not.toHaveProperty("connectedToDeviceId");
    expect(update).not.toHaveProperty("connectedToPortId");
    expect(summary.portsUpdated).toBe(1);
  });

  it("skips the update when nothing changed", async () => {
    stubEnv({});
    stubFetch([SWITCH_A]);
    mocks.selectResults.push(
      [DEVICE_IP],
      [{ id: 100, vlanId: 88, name: "IPH-DEVICE" }, { id: 101, vlanId: 11, name: "MGMT" }],
      [
        {
          id: 500, deviceId: 10, portName: "port1.0.1", portMode: "Trunk", vlanId: 101,
          trunkVlans: "88, 11", status: "Active", description: "uplink",
        },
      ],
    );

    const summary = await syncNetworkDocs(7);

    expect(summary.portsUpdated).toBe(0);
    expect(mocks.updateSets).toHaveLength(0);
  });
});
