import { describe, expect, it } from "vitest";
import { normalizeFortigate } from "./fortigate";

describe("normalizeFortigate", () => {
  it("detects firewall deny", () => {
    expect(normalizeFortigate("date=2026-06-03 action=deny srcip=10.0.0.5 dstip=8.8.8.8 dstport=53 proto=17")).toMatchObject({
      category: "Firewall",
      normalizedType: "firewall_deny",
      action: "deny",
      outcome: "blocked",
      srcIp: "10.0.0.5",
      dstIp: "8.8.8.8",
      dstPort: 53
    });
  });

  it("detects vpn failure", () => {
    expect(normalizeFortigate("action=vpn user=testuser remip=192.168.1.100 msg=vpn connection failed")).toMatchObject({
      category: "Firewall",
      normalizedType: "vpn_login_failed",
      username: "testuser",
      srcIp: "192.168.1.100"
    });
  });
});
