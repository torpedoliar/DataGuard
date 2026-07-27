import { describe, expect, it } from "vitest";
import { normalizeMikrotik } from "./mikrotik";

describe("normalizeMikrotik", () => {
  it("detects login failure", () => {
    expect(normalizeMikrotik("login failure for user admin from 192.168.88.2")).toMatchObject({
      normalizedType: "auth_failed",
      username: "admin"
    });
  });

  it("detects dhcp conflict", () => {
    expect(normalizeMikrotik("dhcp alert on bridge1: IP conflict")).toMatchObject({
      normalizedType: "dhcp_conflict",
      category: "Network"
    });
  });
});
