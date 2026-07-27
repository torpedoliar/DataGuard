import { describe, expect, it } from "vitest";
import { normalizeCisco } from "./cisco";

describe("normalizeCisco", () => {
  it("detects link up/down", () => {
    expect(normalizeCisco("%LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down")).toMatchObject({
      normalizedType: "interface_down",
      interfaceName: "GigabitEthernet0/1",
      metadata: { ciscoMnemonic: "LINK-UPDOWN" }
    });
  });
  
  it("detects login failed", () => {
    expect(normalizeCisco("%SEC_LOGIN-4-LOGIN_FAILED: Login failed [user: admin] [Source: 192.168.1.1]")).toMatchObject({
      normalizedType: "auth_failed",
      metadata: { ciscoMnemonic: "SEC_LOGIN" }
    });
  });
});
