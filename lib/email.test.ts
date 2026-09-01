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
  DEFAULT_EMAIL_ALERT_TEMPLATE,
  renderEmailTemplate,
  resolveChecklistPicRecipients,
  sendChecklistPicEmail,
  isEmailConfigured,
} = await import("./email");

const mockedDb = db as unknown as {
  select: ReturnType<typeof vi.fn>;
};
// SMTP-settings lookup chain: select().from().limit() → rows. Undefined rows
// = "not configured in DB", so env SMTP_URL alone drives the config checks.
mockedDb.select.mockReturnValue({
  from: () => ({
    limit: () => Promise.resolve([]),
  }),
});
const mockedCreateTransport = nodemailer.createTransport as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("SMTP_URL", "smtp://relay.test:25");
  vi.stubEnv("SMTP_FROM", "alerts@test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("renderEmailTemplate", () => {
  const context = {
    siteName: "DC Jakarta",
    siteCode: "JKT",
    checker: "budi",
    shift: "Pagi",
    checkDate: "2026-08-31",
    checkTime: "09:30",
    deviceName: "sw-core",
    deviceAssetCode: "AST-001",
    deviceStatus: "NOT OK",
    deviceLocation: "Room 1",
    deviceCategory: "Network",
    deviceRack: "R1 U5",
    deviceIp: "10.0.0.5",
    deviceRemarks: "Fan <blinking> & hot",
    incidentId: "#12",
    incidentLink: "[Open incident #12](https://dc.example.test/admin/incidents/12)",
  };

  it("renders the default template with context values", () => {
    const html = renderEmailTemplate(null, context);

    expect(html).toContain("Data Center Audit Alert");
    expect(html).toContain("Site: DC Jakarta (JKT)");
    expect(html).toContain("<b>Device: sw-core</b>");
    expect(html).toContain("Rack: R1 U5");
    expect(html).toContain("2026-08-31 09:30");
  });

  it("escapes entity-supplied values and converts newlines to <br>", () => {
    const html = renderEmailTemplate("Remarks: {deviceRemarks}", context);

    // The angle brackets and ampersand are escaped; no raw injection.
    expect(html).toContain("Fan &lt;blinking&gt; &amp; hot");
    expect(html).not.toContain("<blinking>");
  });

  it("renders trusted incidentLink as an anchor, other fields escaped", () => {
    const html = renderEmailTemplate("Open: {incidentLink}", context, { trustedLinkFields: ["incidentLink"] });
    expect(html).toContain('<a href="https://dc.example.test/admin/incidents/12">Open incident #12</a>');

    // Without the trusted option (plain-text twin), it stays escaped text.
    const plain = renderEmailTemplate("Open: {incidentLink}", context);
    expect(plain).toContain("[Open incident #12](https://dc.example.test/admin/incidents/12)");
  });

  it("substitutes '-' for empty fields and keeps unknown placeholders intact", () => {
    const html = renderEmailTemplate("IP: {deviceIp} | {unknownField}", {
      deviceIp: null,
    });

    expect(html).toContain("IP: - | {unknownField}");
  });

  it("falls back to the default template for an empty template", () => {
    expect(renderEmailTemplate("   ", { deviceName: "x" })).toContain(DEFAULT_EMAIL_ALERT_TEMPLATE.slice(0, 30));
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

    const result = await sendChecklistPicEmail(["budi@x.test", "sari@x.test"], "Subject", "<b>Body</b>", "Body");

    expect(result).toEqual({ success: true });
    expect(sendMail).toHaveBeenCalledWith({
      from: "alerts@test",
      to: "budi@x.test, sari@x.test",
      subject: "Subject",
      text: "Body",
      html: "<b>Body</b>",
      attachments: [],
    });
  });

  it("returns failure instead of throwing when sendMail rejects", async () => {
    // Different SMTP_URL forces a fresh transporter (the singleton is keyed
    // on the relay URL), isolating this test from the previous mock.
    vi.stubEnv("SMTP_URL", "smtp://failing.test:25");
    const sendMail = vi.fn().mockRejectedValue(new Error("relay down"));
    mockedCreateTransport.mockReturnValue({ sendMail });

    const result = await sendChecklistPicEmail(["pic@x.test"], "Subject", "<b>Body</b>", "Body");

    expect(result.success).toBe(false);
    expect(result.error).toBe("relay down");
  });

  it("isEmailConfigured reflects SMTP_URL (env wins, DB consulted as fallback)", async () => {
    // The mocked db resolves to undefined rows → DB path returns false.
    expect(await isEmailConfigured()).toBe(true);
    vi.stubEnv("SMTP_URL", "");
    // Empty string env → DB path consulted; mock db returns no row → false.
    expect(await isEmailConfigured()).toBe(false);
  });
});
