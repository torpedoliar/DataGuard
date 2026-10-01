import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  results: [] as unknown[],
  selects: 0,
}));

vi.mock("../lib/action-auth", () => ({ requireActiveSiteAction: () => mocks.auth() }));

// Every drizzle builder method returns the same chain; awaiting it yields the
// next queued result. Selects run in call order (device check first, then the
// Promise.all batch in array order).
const chain = (result: unknown): unknown => new Proxy({}, {
  get: (_, key) => key === "then"
    ? (resolve: (v: unknown) => void) => resolve(result)
    : () => chain(result),
});
vi.mock("../db", () => ({
  db: { select: () => { mocks.selects++; return chain(mocks.results.shift()); } },
}));

import { getDeviceDrawer } from "./device-drawer";

beforeEach(() => {
  mocks.selects = 0;
  mocks.results = [];
  mocks.auth.mockResolvedValue({ ok: true, session: {}, activeSiteId: 7 });
});

describe("getDeviceDrawer", () => {
  it("returns pic groups, last audit, incidents, SIEM and connections for a device of the active site", async () => {
    mocks.results = [
      [{ id: 24 }],
      [{ name: "Network Team", color: "#3b82f6" }],
      [{ checkDate: "2026-10-01", shift: "Pagi", status: "NOT OK", remarks: "fan noise", photoPath: "/uploads/x.jpg" }],
      [{ id: 5, title: "Fan failure", severity: "High", status: "Open" }],
      [{ count: 4 }],
      [{ id: 9, title: "Brute force", severity: "Medium" }],
      [{ portName: "Gi1/0/1", portMode: "Access", vlan: 10, peerDeviceId: 18, peerDeviceName: "Web Server 1", peerPortName: "eth0" }],
    ];
    const res = await getDeviceDrawer(24);
    expect(res).toEqual({
      picGroups: [{ name: "Network Team", color: "#3b82f6" }],
      lastAudit: { checkDate: "2026-10-01", shift: "Pagi", status: "NOT OK", remarks: "fan noise", photoPath: "/uploads/x.jpg" },
      incidents: [{ id: 5, title: "Fan failure", severity: "High", status: "Open" }],
      siem: { count: 4, latest: [{ id: 9, title: "Brute force", severity: "Medium" }] },
      connections: [{ portName: "Gi1/0/1", portMode: "Access", vlan: 10, peerDeviceId: 18, peerDeviceName: "Web Server 1", peerPortName: "eth0" }],
    });
  });

  it("returns null and stops for a device outside the active site", async () => {
    mocks.results = [[]];
    expect(await getDeviceDrawer(999)).toBeNull();
    expect(mocks.selects).toBe(1);
  });

  it("returns null without querying when the user has no active site", async () => {
    mocks.auth.mockResolvedValue({ ok: false, message: "Unauthorized." });
    expect(await getDeviceDrawer(24)).toBeNull();
    expect(mocks.selects).toBe(0);
  });

  it("reports no last audit and zero SIEM findings when there are none", async () => {
    mocks.results = [[{ id: 24 }], [], [], [], [], [], []];
    const res = await getDeviceDrawer(24);
    expect(res?.lastAudit).toBeNull();
    expect(res?.siem).toEqual({ count: 0, latest: [] });
  });
});
