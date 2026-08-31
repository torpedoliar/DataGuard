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

  it("builds subject with total count, site code, date and shift", () => {
    const { subject } = buildChecklistPicEmail({
      siteName: "DC Jakarta",
      siteCode: "JKT",
      checkDate: "2026-08-31",
      checkTime: "09:30",
      shift: "Pagi",
      checker: "budi",
      groups: [{ groupName: "Network", emails: ["pic@x.test"], devices }],
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
      groups: [{ groupName: "Network", emails: ["pic@x.test"], devices }],
      baseUrl: "https://dc.example.test",
    });

    expect(text).toContain("• sw-core (AST-001) — R1 U5 — Network — Remarks: Fan LED blinking (Incident #12)");
    expect(text).toContain("• ups-a — Remarks: -");
    expect(text).toContain("https://dc.example.test/admin/incidents");
    expect(text).toContain("shift Pagi");
    expect(text).toContain("by budi");
    expect(deviceCount).toBe(2);
    // Summary snapshot is the device lines only (no greeting/link).
    expect(deviceSummary).not.toContain("Hello");
    expect(deviceSummary).toContain("sw-core");
  });
});

describe("resolveChecklistPicRecipients", () => {
  function mockQueryRows(rows: Array<{
    deviceId: number;
    groupId: number;
    groupName: string;
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

  it("returns one entry per group with deduped member emails and devices", async () => {
    mockQueryRows([
      { deviceId: 1, groupId: 10, groupName: "Network", userId: 7, email: "budi@x.test", username: "budi" },
      { deviceId: 1, groupId: 10, groupName: "Network", userId: 8, email: "sari@x.test", username: "sari" },
      { deviceId: 2, groupId: 10, groupName: "Network", userId: 7, email: "budi@x.test", username: "budi" },
      { deviceId: 2, groupId: 11, groupName: "Power", userId: 9, email: "andre@x.test", username: "andre" },
      { deviceId: 2, groupId: 11, groupName: "Power", userId: 7, email: "budi@x.test", username: "budi" }, // second group
    ]);

    const map = await resolveChecklistPicRecipients([1, 2], 1);

    expect(map.size).toBe(2);
    expect(map.get(10)).toEqual({
      groupId: 10,
      groupName: "Network",
      emails: ["budi@x.test", "sari@x.test"],
      memberNames: ["budi", "sari"],
      deviceIds: [1, 2],
    });
    expect(map.get(11)).toEqual({
      groupId: 11,
      groupName: "Power",
      emails: ["andre@x.test", "budi@x.test"],
      memberNames: ["andre", "budi"],
      deviceIds: [2],
    });
  });

  it("returns an empty map for no device ids without querying", async () => {
    const map = await resolveChecklistPicRecipients([], 1);
    expect(map.size).toBe(0);
    expect(mockedDb.select).not.toHaveBeenCalled();
  });
});

describe("sendChecklistPicEmail", () => {
  it("sends via the configured transporter with a multi-recipient To line", async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    mockedCreateTransport.mockReturnValue({ sendMail });

    const result = await sendChecklistPicEmail(["budi@x.test", "sari@x.test"], "Subject", "Body");

    expect(result).toEqual({ success: true });
    expect(sendMail).toHaveBeenCalledWith({
      from: "alerts@test",
      to: "budi@x.test, sari@x.test",
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

    const result = await sendChecklistPicEmail(["pic@x.test"], "Subject", "Body");

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
