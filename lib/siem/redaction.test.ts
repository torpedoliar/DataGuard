import { describe, expect, it } from "vitest";
import { createHostMasker, redactSensitiveText } from "./redaction";

describe("redactSensitiveText", () => {
  it("redacts passwords, tokens, api keys, authorization, cookies, and private keys", () => {
    const input = [
      "password=secret123",
      "token: abc123",
      "api_key=my-key",
      "authorization: Bearer xyz",
      "session=abc",
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    ].join(" ");

    const output = redactSensitiveText(input);

    expect(output).not.toContain("secret123");
    expect(output).not.toContain("abc123");
    expect(output).not.toContain("my-key");
    expect(output).not.toContain("xyz");
    expect(output).not.toContain("-----BEGIN");
    expect(output).toContain("[REDACTED]");
  });
});

describe("createHostMasker", () => {
  it("maps each IP to a stable token, reused across fields and text", () => {
    const mask = createHostMasker();
    expect(mask.host("10.0.0.5")).toBe("HOST_A");
    expect(mask.host("10.0.0.6")).toBe("HOST_B");
    expect(mask.host("10.0.0.5")).toBe("HOST_A"); // same IP -> same token
    // In-text masking shares the same token map.
    expect(mask.text("from 10.0.0.5 to 10.0.0.6")).toBe("from HOST_A to HOST_B");
  });

  it("masks IPv6 and MAC addresses without leaking originals", () => {
    const mask = createHostMasker();
    const out = mask.text("ipv6 fe80::1ff:fe23:4567:890a mac 00:1A:2B:3C:4D:5E");
    expect(out).not.toContain("fe80::1ff:fe23:4567:890a");
    expect(out).not.toContain("00:1A:2B:3C:4D:5E");
    expect(out).toContain("HOST_A");
    expect(out).toContain("MAC_A");
  });

  it("treats null/empty IPs as passthrough null", () => {
    const mask = createHostMasker();
    expect(mask.host(null)).toBeNull();
    expect(mask.host("")).toBeNull();
  });

  it("masks usernames to stable tokens, in fields and registered in text", () => {
    const mask = createHostMasker();
    expect(mask.user("admin")).toBe("USER_A");
    expect(mask.user("svc-backup")).toBe("USER_B");
    expect(mask.user("admin")).toBe("USER_A"); // same name -> same token
    expect(mask.user(null)).toBeNull();
    expect(mask.user("")).toBeNull();
    // Once registered, the name is masked where it appears in free text too.
    expect(mask.text("login by admin from 10.0.0.5")).toBe("login by USER_A from HOST_A");
  });
});
