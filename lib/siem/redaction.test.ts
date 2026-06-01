import { describe, expect, it } from "vitest";
import { redactSensitiveText } from "./redaction";

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
