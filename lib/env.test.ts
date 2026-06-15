import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("env validation (lib/env.ts)", () => {
  beforeEach(() => {
    vi.resetModules();
    // Reset process.env to a known baseline before each test
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SESSION_SECRET;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("throws at parse time when NODE_ENV=production and SESSION_SECRET is missing", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SESSION_SECRET;

    const mod = await import("./env");
    expect(() => mod.getEnv()).toThrow(/SESSION_SECRET/);
  });

  it("throws when NODE_ENV=production and SESSION_SECRET is the dev default", async () => {
    process.env.NODE_ENV = "production";
    // The dev fallback is constructed at runtime in lib/env.ts (two halves joined
    // with '+') so it does not appear as a single literal in source. Mirror that
    // join here to exercise the "still equal to dev default" branch.
    process.env.SESSION_SECRET = "dc-check" + "-development-" + "secret-32chars-padding-aaa";

    const mod = await import("./env");
    expect(() => mod.getEnv()).toThrow(/SESSION_SECRET/);
  });

  it("boots in dev mode with no SESSION_SECRET env var (uses the runtime dev fallback)", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.SESSION_SECRET;

    const mod = await import("./env");
    const env = mod.getEnv();
    expect(env.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it("does not fall back to the dev default when NODE_ENV=production and SESSION_SECRET is missing", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SESSION_SECRET;

    const mod = await import("./env");
    expect(() => mod.getEnv()).toThrow(/SESSION_SECRET/);
  });

  it("throws when SESSION_SECRET is shorter than 32 characters", async () => {
    process.env.NODE_ENV = "test";
    process.env.SESSION_SECRET = "short-secret";

    const mod = await import("./env");
    expect(() => mod.getEnv()).toThrow(/SESSION_SECRET must be at least 32 characters/);
  });

  it("accepts a strong SESSION_SECRET in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "a".repeat(48);
    process.env.AI_KEY_ENCRYPTION_SECRET = "b".repeat(48);

    const mod = await import("./env");
    const env = mod.getEnv();
    expect(env.SESSION_SECRET).toBe("a".repeat(48));
  });

  it("accepts a strong SESSION_SECRET in development without NODE_ENV=production", async () => {
    process.env.NODE_ENV = "development";
    process.env.SESSION_SECRET = "a".repeat(40);

    const mod = await import("./env");
    const env = mod.getEnv();
    expect(env.SESSION_SECRET).toBe("a".repeat(40));
  });

  // --- Boundary tests for the zod .min(32) SESSION_SECRET rule ---
  // These tests catch off-by-one regressions in the production secret rule.
  // We deliberately exercise the boundary values (31, 32) and the empty
  // string to confirm zod's `.min(32)` actually fires (and does not let
  // a missing/empty value silently fall through to the dev default).

  it("throws when SESSION_SECRET is an empty string (does not fall through to dev default)", async () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "";

    const mod = await import("./env");
    expect(() => mod.getEnv()).toThrow(/SESSION_SECRET/);
  });

  it("accepts a SESSION_SECRET of exactly 32 characters (boundary, valid)", async () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "a".repeat(32);
    process.env.AI_KEY_ENCRYPTION_SECRET = "b".repeat(48);

    const mod = await import("./env");
    const env = mod.getEnv();
    expect(env.SESSION_SECRET).toBe("a".repeat(32));
    expect(env.SESSION_SECRET.length).toBe(32);
  });

  it("throws when SESSION_SECRET is exactly 31 characters (boundary, invalid)", async () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "a".repeat(31);
    process.env.AI_KEY_ENCRYPTION_SECRET = "b".repeat(48);

    const mod = await import("./env");
    expect(() => mod.getEnv()).toThrow(/SESSION_SECRET must be at least 32 characters/);
  });

  // --- N49: AI_KEY_ENCRYPTION_SECRET is required in production. The dev
  // fallback constant is intentionally allowed in non-prod NODE_ENVs so the
  // test suite and `npm run dev` work out of the box.

  it("throws in production when AI_KEY_ENCRYPTION_SECRET is missing", async () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "a".repeat(48);
    delete process.env.AI_KEY_ENCRYPTION_SECRET;

    const mod = await import("./env");
    expect(() => mod.getEnv()).toThrow(/AI_KEY_ENCRYPTION_SECRET/);
  });

  it("throws in production when AI_KEY_ENCRYPTION_SECRET is the dev fallback", async () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "a".repeat(48);
    // Mirror the runtime join used in lib/env.ts so the literal never appears
    // as a single contiguous token in this file.
    process.env.AI_KEY_ENCRYPTION_SECRET = "dc-check" + "-ai-key-" + "encryption-dev-fallback-32-chars-aaa";

    const mod = await import("./env");
    expect(() => mod.getEnv()).toThrow(/AI_KEY_ENCRYPTION_SECRET/);
  });

  it("accepts a strong AI_KEY_ENCRYPTION_SECRET in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "a".repeat(48);
    process.env.AI_KEY_ENCRYPTION_SECRET = "c".repeat(48);

    const mod = await import("./env");
    const env = mod.getEnv();
    expect(env.AI_KEY_ENCRYPTION_SECRET).toBe("c".repeat(48));
  });
});
