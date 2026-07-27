import { describe, expect, it } from "vitest";
import { normalizeWatchguard } from "./watchguard";

describe("normalizeWatchguard", () => {
  it("detects firewall deny", () => {
    expect(normalizeWatchguard("disp=Deny src=192.168.1.5 dst=8.8.8.8 dst_port=53 proto=17")).toMatchObject({
      normalizedType: "firewall_deny",
      srcIp: "192.168.1.5",
      dstIp: "8.8.8.8",
      dstPort: 53
    });
  });

  it("detects login failure", () => {
    expect(normalizeWatchguard("login failed user=admin src=192.168.1.100")).toMatchObject({
      normalizedType: "auth_failed",
      username: "admin",
      srcIp: "192.168.1.100"
    });
  });
});
