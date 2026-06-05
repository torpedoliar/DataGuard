import { describe, expect, it } from "vitest";
import { buildEvidenceSnapshot, type JoinedEventRow } from "./evidence";

const baseRow: JoinedEventRow = {
  id: 42,
  eventTime: new Date("2026-06-01T10:00:00.000Z"),
  receivedAt: new Date("2026-06-01T10:00:01.000Z"),
  sourceIp: "10.0.0.5",
  hostname: "fw-01",
  deviceId: 7,
  sourceId: 3,
  message: "login failed",
  rawMessage: "<13>Jun 1 10:00:00 fw-01 login failed",
  category: "Authentication",
  normalizedType: "auth.login_failed",
  action: "login",
  outcome: "failure",
  srcIp: "192.168.1.9",
  dstIp: "10.0.0.5",
  username: "admin",
  severity: 4,
  metadata: { vendor: "fortigate" },
};

describe("buildEvidenceSnapshot", () => {
  it("copies all evidence columns and stamps the finding + original event id", () => {
    const snap = buildEvidenceSnapshot(99, baseRow);
    expect(snap).toMatchObject({
      findingId: 99,
      originalEventId: 42,
      sourceIp: "10.0.0.5",
      message: "login failed",
      rawMessage: "<13>Jun 1 10:00:00 fw-01 login failed",
      normalizedType: "auth.login_failed",
      username: "admin",
      severity: 4,
      metadata: { vendor: "fortigate" },
    });
  });

  it("self-contains rawMessage so the snapshot survives deletion of the raw row", () => {
    const snap = buildEvidenceSnapshot(99, baseRow);
    expect(snap.rawMessage).toBe("<13>Jun 1 10:00:00 fw-01 login failed");
  });

  it("defaults a null metadata to an empty object", () => {
    const snap = buildEvidenceSnapshot(99, { ...baseRow, metadata: null });
    expect(snap.metadata).toEqual({});
  });

  it("preserves nullable fields as null", () => {
    const snap = buildEvidenceSnapshot(99, { ...baseRow, hostname: null, rawMessage: null, username: null });
    expect(snap.hostname).toBeNull();
    expect(snap.rawMessage).toBeNull();
    expect(snap.username).toBeNull();
  });
});
