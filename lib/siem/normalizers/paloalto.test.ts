import { describe, expect, it } from "vitest";
import { normalizePaloAlto } from "./paloalto";

describe("normalizePaloAlto", () => {
  it("parses a THREAT log line", () => {
    const line = "1,2024/01/15,10:30:00,00123456789,THREAT,url,1,2024/01/15,10:30:00,10.0.0.5,8.8.8.8,0.0.0.0,0.0.0.0,deny,high,ssl,443";
    const result = normalizePaloAlto(line);
    expect(result).toMatchObject({
      category: "Firewall",
      normalizedType: "firewall_deny",
      action: "deny",
      outcome: "blocked",
      srcIp: "10.0.0.5",
      dstIp: "8.8.8.8",
      dstPort: 443,
      protocol: "ssl",
    });
  });

  it("parses a TRAFFIC log with allow action", () => {
    const line = "1,2024/01/15,10:30:00,00123456789,TRAFFIC,start,1,2024/01/15,10:30:00,10.0.0.5,8.8.8.8,0.0.0.0,0.0.0.0,allow,informational,tcp,443";
    const result = normalizePaloAlto(line);
    expect(result).toMatchObject({
      category: "Network",
      normalizedType: "firewall_allow",
      action: "allow",
      outcome: "allowed",
      srcIp: "10.0.0.5",
      dstIp: "8.8.8.8",
      dstPort: 443,
      protocol: "tcp",
    });
  });

  it("parses a SYSTEM log", () => {
    const line = "1,2024/01/15,10:30:00,00123456789,SYSTEM,config,1,2024/01/15,10:30:00,,,0.0.0.0,0.0.0.0,,informational,,0";
    const result = normalizePaloAlto(line);
    expect(result.category).toBe("System");
    expect(result.normalizedType).toBe("system_event");
  });

  it("returns empty event for unrecognized format", () => {
    const result = normalizePaloAlto("this is not a palo alto log line");
    expect(result.category).toBeNull();
    expect(result.normalizedType).toBeNull();
  });

  it("handles empty string", () => {
    const result = normalizePaloAlto("");
    expect(result.category).toBeNull();
  });
});
