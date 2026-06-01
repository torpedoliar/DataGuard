import { describe, expect, it } from "vitest";
import { normalizeGeneric } from "./generic";

describe("normalizeGeneric", () => {
  it("detects failed login", () => {
    expect(normalizeGeneric("Failed password for admin from 10.10.1.20 port 22 ssh2")).toMatchObject({
      category: "Authentication",
      normalizedType: "auth_failed",
      outcome: "failure",
      username: "admin",
      srcIp: "10.10.1.20",
    });
  });

  it("detects interface down", () => {
    expect(normalizeGeneric("interface ether1 link down")).toMatchObject({ normalizedType: "interface_down", interfaceName: "ether1" });
  });

  it("detects firewall deny", () => {
    expect(normalizeGeneric("firewall denied tcp from 10.0.0.2 to 10.0.0.3 port 443")).toMatchObject({ normalizedType: "firewall_deny", action: "deny", srcIp: "10.0.0.2", dstIp: "10.0.0.3", dstPort: 443 });
  });
});
