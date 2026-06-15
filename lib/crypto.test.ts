import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Test secret with at least 32 characters. Constant across the suite.
const TEST_SECRET = "a".repeat(64); // 64 hex-like chars -> 32 bytes when treated as raw
const TEST_SECRET_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 64 hex chars

const ORIGINAL_ENV = { ...process.env };

function setSecret(secret: string | undefined) {
  if (secret === undefined) {
    delete process.env.AI_KEY_ENCRYPTION_SECRET;
  } else {
    process.env.AI_KEY_ENCRYPTION_SECRET = secret;
  }
}

describe("lib/crypto.ts", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    setSecret(TEST_SECRET_HEX);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("encryptString produces a v1:<iv>.<ct>.<tag> base64url envelope", async () => {
    const { encryptString, isEncryptedString } = await import("./crypto");
    const cipher = encryptString("hello-world");
    expect(cipher.startsWith("v1:")).toBe(true);
    const body = cipher.slice(3);
    const parts = body.split(".");
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0);
      // base64url alphabet: A-Z a-z 0-9 - _
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    expect(isEncryptedString(cipher)).toBe(true);
  });

  it("roundtrips: decryptString(encryptString(x)) === x for various inputs", async () => {
    const { encryptString, decryptString } = await import("./crypto");
    const cases = [
      "sk-1234567890abcdef",
      "",
      "unicode: é 🚀 ñ",
      "a".repeat(500),
      "with\nnewlines\nand\ttabs",
      '{"json":true,"nested":{"k":"v"}}',
      "0".repeat(64),
      " ",
    ];
    for (const plain of cases) {
      const cipher = encryptString(plain);
      expect(decryptString(cipher)).toBe(plain);
    }
  });

  it("isEncryptedString returns true for encrypted and false for plaintext", async () => {
    const { encryptString, isEncryptedString } = await import("./crypto");
    expect(isEncryptedString(encryptString("anything"))).toBe(true);
    expect(isEncryptedString("sk-plain-text-key")).toBe(false);
    expect(isEncryptedString("v1:not-base64-at-all")).toBe(false);
    expect(isEncryptedString("v1:abc.def")).toBe(false); // only 2 parts
    expect(isEncryptedString("v1:abc.def.ghi.jkl")).toBe(false); // 4 parts
    expect(isEncryptedString("v2:abc.def.ghi")).toBe(false); // wrong version
    expect(isEncryptedString("")).toBe(false);
  });

  it("throws on decrypt when the key is wrong", async () => {
    const { encryptString } = await import("./crypto");
    const cipher = encryptString("secret");
    // Swap the secret to a different value and re-import the module so the
    // cached derived key reflects the new env var.
    setSecret("b".repeat(64));
    vi.resetModules();
    const { decryptString } = await import("./crypto");
    expect(() => decryptString(cipher)).toThrow();
  });

  it("throws on malformed ciphertext input", async () => {
    const { decryptString } = await import("./crypto");
    expect(() => decryptString("not-a-cipher")).toThrow();
    expect(() => decryptString("v1:!!!.@@@.###")).toThrow(); // not valid base64url
    expect(() => decryptString("v1:abc.def")).toThrow(); // missing tag
    expect(() => decryptString("v1:")).toThrow();
  });
});
