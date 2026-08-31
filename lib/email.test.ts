import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock db + nodemailer before importing the SUT (pattern of
// lib/siem/alerts.test.ts).
vi.mock("../db", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: vi.fn() })),
  },
}));

const { db } = await import("../db");
const { default: nodemailer } = await import("nodemailer");
const {
  buildChecklistPicEmail,
  resolveChecklistPicRecipients,
  sendChecklistPicEmail,
  isEmailConfigured,
} = await import("./email");

const mockedDb = db as unknown as {
  select: ReturnType<typeof vi.fn>;
};
const mockedCreateTransport = nodemailer.createTransport as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("SMTP_URL", "smtp://relay.test:25");
  vi.stubEnv("SMTP_FROM", "alerts@test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("buildChecklistPicEmail", () => {
  const devices = [
    {
      id: 1,
      name: "sw-core",
      assetCode: "AST-001",
      rackName: "R1",
      rackPosition: 5,
      categoryName: "Network",
      remarks: "Fan LED blinking",
      incidentId: 12,
    },
    {
      id: 2,
      name: "ups-a",
      assetCode: null,
      rackName: null,
      rackPosition: null,
      categoryName: null,
      remarks: "",
      incidentId: null,
    },
  ];

  it("builds subject with count, site code, date and shift", () => {
    const { subject } = buildChecklistPicEmail({
      siteName: "DC Jakarta",
      siteCode: "JKT",
      checkDate: "2026-08-31",
      checkTime: "09:30",
      shift: "Pagi",
      checker: "budi",
      devices,
      baseUrl: "https://dc.example.test",
    });
    expect(subject).toContain("2 devices NOT OK");
    expect(subject).toContain("JKT");
    expect(subject).toContain("2026-08-31");
    expect(subject).toContain("Pagi");
  });

  it("lists each device with rack, remarks and incident link, and exposes summary", () => {
    const { text, deviceCount, deviceSummary } = buildChecklistPicEmail({
      siteName: "DC Jakarta",
      siteCode: "JKT",
      checkDate: "2026-08-31",
      checkTime: "09:30",
      shift: "Pagi",
      checker: "budi",
      devices,
      baseUrl: "https://dc.example.test",
    });

    expect(text).toContain("1. sw-core (AST-001) — R1 U5 — Network — Remarks: Fan LED blinking (Incident #12)");
    expect(text).toContain("2. ups-a — Remarks: -");
    expect(text).toContain("https://dc.example.test/admin/incidents");
    expect(text).toContain("shift Pagi");
    expect(text).toContain("by budi");
    expect(deviceCount).toBe(2);
    // Summary snapshot is the numbered device lines only (no greeting/link).
    expect(deviceSummary).not.toContain("Hello");
    expect(deviceSummary).toContain("sw-core");
  });
});

describe("resolveChecklistPicRecipients", () => {
  function mockQueryRows(rows: Array<{
    deviceId: number;
    groupId: number;
    userId: number;
    email: string | null;
    username: string;
  }>) {
    mockedDb.select.mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: () => Promise.resolve(rows),
          }),
        }),
      }),
    });
  }

  it("groups devices per recipient email and dedupes devices", async () => {
    mockQueryRows([
      { deviceId: 1, groupId: 10, userId: 7, email: "pic@x.test", username: "budi" },
      { deviceId: 2, groupId: 11, userId: 7, email: "pic@x.test", username: "budi" },
      { deviceId: 2, groupId: 12, userId: 8, email: "sari@x.test", username: "sari" },
      { deviceId: 1, groupId: 10, userId: 7, email: "pic@x.test", username: "budi" }, // duplicate row
    ]);

    const map = await resolveChecklistPicRecipients([1, 2], 1);

    expect(map.size).toBe(2);
    const budi = map.get("pic@x.test");
    expect(budi).toEqual({ userId: 7, name: "budi", deviceIds: [1, 2] });
    expect(map.get("sari@x.test")).toEqual({ userId: 8, name: "sari", deviceIds: [2] });
  });

  it("dedupes a device when one user owns two groups bound to it", async () => {
    mockQueryRows([
      { deviceId: 1, groupId: 10, userId: 7, email: "pic@x.test", username: "budi" },
      { deviceId: 1, groupId: 11, userId: 7, email: "pic@x.test", username: "budi" },
    ]);

    const map = await resolveChecklistPicRecipients([1], 1);

    expect(map.size).toBe(1);
    expect(map.get("pic@x.test")).toEqual({ userId: 7, name: "budi", deviceIds: [1] });
  });

  it("returns an empty map for no device ids without querying", async () => {
    const map = await resolveChecklistPicRecipients([], 1);
    expect(map.size).toBe(0);
    expect(mockedDb.select).not.toHaveBeenCalled();
  });
});

describe("sendChecklistPicEmail", () => {
  it("sends via the configured transporter and returns success", async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    mockedCreateTransport.mockReturnValue({ sendMail });

    const result = await sendChecklistPicEmail("pic@x.test", "Subject", "Body");

    expect(result).toEqual({ success: true });
    expect(sendMail).toHaveBeenCalledWith({
      from: "alerts@test",
      to: "pic@x.test",
      subject: "Subject",
      text: "Body",
    });
  });

  it("returns failure instead of throwing when sendMail rejects", async () => {
    // Different SMTP_URL forces a fresh transporter (the singleton is keyed
    // on the relay URL), isolating this test from the previous mock.
    vi.stubEnv("SMTP_URL", "smtp://failing.test:25");
    const sendMail = vi.fn().mockRejectedValue(new Error("relay down"));
    mockedCreateTransport.mockReturnValue({ sendMail });

    const result = await sendChecklistPicEmail("pic@x.test", "Subject", "Body");

    expect(result.success).toBe(false);
    expect(result.error).toBe("relay down");
  });

  it("isEmailConfigured reflects SMTP_URL", () => {
    expect(isEmailConfigured()).toBe(true);
    vi.stubEnv("SMTP_URL", "");
    // Empty string is still falsy → unconfigured.
    expect(isEmailConfigured()).toBe(false);
  });
});
