import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock action-auth so the SUT does not require a live session.
vi.mock("@/lib/action-auth", () => ({
  requireActiveSiteAdminAction: async () => ({
    ok: true,
    session: { userId: 1, username: "u", role: "admin" } as never,
    activeSiteId: 1,
  }),
}));

// Mock audit so we don't hit the DB.
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Chainable mock db
const selectMock = vi.fn();
const insertMock = vi.fn();
vi.mock("@/db", () => ({
  db: {
    select: (..._args: unknown[]) => selectMock(),
    insert: (..._args: unknown[]) => insertMock(),
  },
}));

import { importPortsFromFile } from "./network";

function makeSelectChain(rows: unknown[], opts: { withLimit?: boolean } = {}) {
  const limit = vi.fn().mockResolvedValue(rows);
  // when awaited directly, where() resolves to rows. when chained to .limit(),
  // it returns the chain object. for the device lookup we use withLimit.
  const where: any = opts.withLimit
    ? vi.fn().mockReturnValue({ limit })
    : vi.fn().mockImplementation(() => {
        // Make where() thenable so awaiting it returns rows
        const p: any = Promise.resolve(rows);
        return p;
      });
  const from = vi.fn().mockReturnValue({ where });
  return { from };
}

function makeInsertChain() {
  const values = vi.fn().mockResolvedValue(undefined);
  return { values };
}

function buildCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
}

function makeFile(name: string, content: string): File {
  return new File([content], name, { type: name.endsWith(".csv") ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("importPortsFromFile", () => {
  it("returns an Empty file error for an empty file", async () => {
    const fd = new FormData();
    fd.append("file", makeFile("ports.csv", ""));
    const result = await importPortsFromFile(7, fd);
    expect(result.success).toBe(false);
    expect(result.inserted).toBe(0);
    expect(result.errors).toContain("Empty file");
  });

  it("inserts valid CSV rows and returns success", async () => {
    const csv = buildCsv([
      ["Port Name", "Port Mode", "Status", "Speed", "Media Type", "VLAN ID", "MAC Address", "IP Address", "Allowed Trunk VLANs", "Description"],
      ["Gi1/0/1", "Access", "Active", "1G", "Copper (RJ45)", "100", "", "", "", "Uplink A"],
      ["Gi1/0/2", "Trunk", "Active", "10G", "Fiber (SFP/SFP+)", "", "", "", "10,20", "Uplink B"],
      ["Gi1/0/3", "Access", "Active", "1G", "Copper (RJ45)", "200", "", "", "", ""],
    ]);

    const fd = new FormData();
    fd.append("file", makeFile("ports.csv", csv));

    // 1st call: device lookup (with .limit()); 2nd: vlans; 3rd: existing ports
    selectMock
      .mockReturnValueOnce(makeSelectChain([{ id: 7 }], { withLimit: true }))
      .mockReturnValueOnce(makeSelectChain([{ id: 10, vlanId: 100, name: "Server" }, { id: 11, vlanId: 200, name: "User" }]))
      .mockReturnValueOnce(makeSelectChain([]));
    insertMock.mockReturnValue(makeInsertChain());

    const result = await importPortsFromFile(7, fd);
    expect(result.success).toBe(true);
    expect(result.inserted).toBe(3);
    expect(result.errors).toEqual([]);
    expect(insertMock).toHaveBeenCalled();
  });

  it("returns errors for invalid CSV (missing required Port Name)", async () => {
    const csv = buildCsv([
      ["Port Name", "Port Mode", "Status", "Speed", "Media Type", "VLAN ID", "MAC Address", "IP Address", "Allowed Trunk VLANs", "Description"],
      ["", "Access", "Active", "1G", "Copper (RJ45)", "", "", "", "", ""],
      ["Gi1/0/1", "BadMode", "Active", "1G", "Copper (RJ45)", "", "", "", "", ""],
    ]);

    const fd = new FormData();
    fd.append("file", makeFile("ports.csv", csv));

    selectMock
      .mockReturnValueOnce(makeSelectChain([{ id: 7 }], { withLimit: true }))
      .mockReturnValueOnce(makeSelectChain([{ id: 10, vlanId: 100, name: "Server" }]))
      .mockReturnValueOnce(makeSelectChain([]));
    insertMock.mockReturnValue(makeInsertChain());

    const result = await importPortsFromFile(7, fd);
    expect(result.success).toBe(false);
    expect(result.inserted).toBe(0);
    expect(result.errors.some((e) => /Port Name is required/.test(e))).toBe(true);
    expect(result.errors.some((e) => /Port Mode must be one of/.test(e))).toBe(true);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
