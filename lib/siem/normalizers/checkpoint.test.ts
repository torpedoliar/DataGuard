import { describe, expect, it } from "vitest";
import { normalizeCheckpoint } from "./checkpoint";

describe("normalizeCheckpoint", () => {
  it("parses an accept action", () => {
    const line = "src=10.0.0.1 dst=8.8.8.8 proto=tcp sport=12345 dport=443 action=accept";
    const result = normalizeCheckpoint(line);
    expect(result).toMatchObject({
      category: "Firewall",
      normalizedType: "firewall_allow",
      action: "allow",
      outcome: "allowed",
      srcIp: "10.0.0.1",
      dstIp: "8.8.8.8",
      srcPort: 12345,
      dstPort: 443,
      protocol: "tcp",
    });
  });

  it("parses a drop action", () => {
    const line = "src=10.0.0.5 dst=1.2.3.4 proto=udp sport=55555 dport=53 action=drop";
    const result = normalizeCheckpoint(line);
    expect(result).toMatchObject({
      category: "Firewall",
      normalizedType: "firewall_deny",
      action: "drop",
      outcome: "dropped",
      srcIp: "10.0.0.5",
      dstIp: "1.2.3.4",
      srcPort: 55555,
      dstPort: 53,
      protocol: "udp",
    });
  });

  it("parses a reject action", () => {
    const line = "src=10.0.0.2 dst=10.0.0.3 proto=tcp sport=33333 dport=22 action=reject";
    const result = normalizeCheckpoint(line);
    expect(result).toMatchObject({
      category: "Firewall",
      normalizedType: "firewall_deny",
      action: "reject",
      outcome: "rejected",
      srcIp: "10.0.0.2",
      dstPort: 22,
    });
  });

  it("returns empty event for unrecognized format", () => {
    const result = normalizeCheckpoint("this is not a checkpoint log");
    expect(result.category).toBeNull();
    expect(result.normalizedType).toBeNull();
  });

  it("handles empty string", () => {
    const result = normalizeCheckpoint("");
    expect(result.category).toBeNull();
  });
});
