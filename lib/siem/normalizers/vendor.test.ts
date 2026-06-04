import { describe, expect, it } from "vitest";
import { normalizeCisco } from "./cisco";
import { normalizeFortigate } from "./fortigate";
import { normalizeLinux } from "./linux";
import { normalizeMikrotik } from "./mikrotik";
import { normalizeWatchguard } from "./watchguard";

describe("vendor normalizers", () => {
  it("normalizes Cisco link down", () => {
    expect(normalizeCisco("%LINK-3-UPDOWN: Interface GigabitEthernet1/0/1, changed state to down")).toMatchObject({ normalizedType: "interface_down", interfaceName: "GigabitEthernet1/0/1" });
  });

  it("normalizes Fortigate deny", () => {
    expect(normalizeFortigate("type=traffic action=deny srcip=10.0.0.2 dstip=10.0.0.3 dstport=443 proto=6")).toMatchObject({ normalizedType: "firewall_deny", srcIp: "10.0.0.2", dstIp: "10.0.0.3", dstPort: 443 });
  });

  it("normalizes Linux sudo command", () => {
    expect(normalizeLinux("sudo: admin : TTY=pts/0 ; COMMAND=/bin/systemctl restart nginx")).toMatchObject({ normalizedType: "sudo_command", username: "admin" });
  });

  it("normalizes MikroTik login failure", () => {
    expect(normalizeMikrotik("login failure for user admin from 10.10.1.20 via ssh")).toMatchObject({ normalizedType: "auth_failed", username: "admin", srcIp: "10.10.1.20" });
  });

  it("normalizes WatchGuard deny", () => {
    expect(normalizeWatchguard('msg_id="3000-0148" Deny disp=Deny src=10.0.0.2 dst=10.0.0.3 dst_port=443 proto=tcp'))
      .toMatchObject({ normalizedType: "firewall_deny", srcIp: "10.0.0.2", dstIp: "10.0.0.3", dstPort: 443 });
  });
  it("normalizes WatchGuard auth failure", () => {
    expect(normalizeWatchguard('Authentication of user failed user=admin src=10.10.1.20'))
      .toMatchObject({ normalizedType: "auth_failed", username: "admin", srcIp: "10.10.1.20" });
  });
});
