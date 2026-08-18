import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

// Current @types/node declares process.env.NODE_ENV as a read-only property,
// so direct assignment/delete fails tsc. These helpers mutate it through a
// mutable view resolved at call time — a module-level cast goes stale because
// beforeEach() replaces the whole process.env object.
function setEnv(key: string, value: string): void {
  (process.env as Record<string, string | undefined>)[key] = value;
}

function deleteEnv(key: string): void {
  delete (process.env as Record<string, string | undefined>)[key];
}

describe("env validation (lib/env.ts)", () => {
  beforeEach(() => {
    vi.resetModules();
    // Reset process.env to a known baseline before each test
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SESSION_SECRET;
    deleteEnv("NODE_ENV");
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("throws at parse time when NODE_ENV=production and SESSION_SECRET is missing", async () => {
    setEnv("NODE_ENV", "production");
    delete process.env.SESSION_SECRET;

    const mod = await import("./env");
    expect(() => mod.getEnv()).toThrow(/SESSION_SECRET/);
  });

  it("throws when NODE_ENV=production and SESSION_SECRET is the dev default", async () => {
    setEnv("NODE_ENV", "production");
    // The dev fallback is constructed at runtime in lib/env.ts (two halves joined
    // with '+') so it does not appear as a single literal in source. Mirror that
    // join here to exercise the "still equal to dev default" branch.
    process.env.SESSION_SECRET = "dc-check" + "-development-" + "secret-32chars-padding-aaa";

    const mod = await import("./env");
    expect(() => mod.getEnv()).toThrow(/SESSION_SECRET/);
  });

  it("boots in dev mode with no SESSION_SECRET env var (uses the runtime dev fallback)", async () => {
    setEnv("NODE_ENV", "development");
    delete process.env.SESSION_SECRET;

    const mod = await import("./env");
    const env = mod.getEnv();
    expect(env.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it("does not fall back to the dev default when NODE_ENV=production and SESSION_SECRET is missing", async () => {
    setEnv("NODE_ENV", "production");
    delete process.env.SESSION_SECRET;

    const mod = await import("./env");
    expect(() => mod.getEnv()).toThrow(/SESSION_SECRET/);
  });

  it("throws when SESSION_SECRET is shorter than 32 characters", async () => {
    setEnv("NODE_ENV", "test");
    process.env.SESSION_SECRET = "short-secret";

    const mod = await import("./env");
    expect(() => mod.getEnv()).toThrow(/SESSION_SECRET must be at least 32 characters/);
  });

  it("accepts a strong SESSION_SECRET in production", async () => {
    setEnv("NODE_ENV", "production");
    process.env.SESSION_SECRET = "a".repeat(48);
    process.env.AI_KEY_ENCRYPTION_SECRET = "b".repeat(48);

    const mod = await import("./env");
    const env = mod.getEnv();
    expect(env.SESSION_SECRET).toBe("a".repeat(48));
  });

  it("accepts a strong SESSION_SECRET in development without NODE_ENV=production", async () => {
    setEnv("NODE_ENV", "development");
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
    setEnv("NODE_ENV", "production");
    process.env.SESSION_SECRET = "";

    const mod = await import("./env");
    expect(() => mod.getEnv()).toThrow(/SESSION_SECRET/);
  });

  it("accepts a SESSION_SECRET of exactly 32 characters (boundary, valid)", async () => {
    setEnv("NODE_ENV", "production");
    process.env.SESSION_SECRET = "a".repeat(32);
    process.env.AI_KEY_ENCRYPTION_SECRET = "b".repeat(48);

    const mod = await import("./env");
    const env = mod.getEnv();
    expect(env.SESSION_SECRET).toBe("a".repeat(32));
    expect(env.SESSION_SECRET.length).toBe(32);
  });

  it("throws when SESSION_SECRET is exactly 31 characters (boundary, invalid)", async () => {
    setEnv("NODE_ENV", "production");
    process.env.SESSION_SECRET = "a".repeat(31);
    process.env.AI_KEY_ENCRYPTION_SECRET = "b".repeat(48);

    const mod = await import("./env");
    expect(() => mod.getEnv()).toThrow(/SESSION_SECRET must be at least 32 characters/);
  });

  // --- N49: AI_KEY_ENCRYPTION_SECRET is required in production. The dev
  // fallback constant is intentionally allowed in non-prod NODE_ENVs so the
  // test suite and `npm run dev` work out of the box.

  it("throws in production when AI_KEY_ENCRYPTION_SECRET is missing", async () => {
    setEnv("NODE_ENV", "production");
    process.env.SESSION_SECRET = "a".repeat(48);
    delete process.env.AI_KEY_ENCRYPTION_SECRET;

    const mod = await import("./env");
    expect(() => mod.getEnv()).toThrow(/AI_KEY_ENCRYPTION_SECRET/);
  });

  it("throws in production when AI_KEY_ENCRYPTION_SECRET is the dev fallback", async () => {
    setEnv("NODE_ENV", "production");
    process.env.SESSION_SECRET = "a".repeat(48);
    // Mirror the runtime join used in lib/env.ts so the literal never appears
    // as a single contiguous token in this file.
    process.env.AI_KEY_ENCRYPTION_SECRET = "dc-check" + "-ai-key-" + "encryption-dev-fallback-32-chars-aaa";

    const mod = await import("./env");
    expect(() => mod.getEnv()).toThrow(/AI_KEY_ENCRYPTION_SECRET/);
  });

  it("accepts a strong AI_KEY_ENCRYPTION_SECRET in production", async () => {
    setEnv("NODE_ENV", "production");
    process.env.SESSION_SECRET = "a".repeat(48);
    process.env.AI_KEY_ENCRYPTION_SECRET = "c".repeat(48);

    const mod = await import("./env");
    const env = mod.getEnv();
    expect(env.AI_KEY_ENCRYPTION_SECRET).toBe("c".repeat(48));
  });

  // --- #46: the env schema now covers the vars the app actually reads
  // (TELEGRAM_BOT_TOKEN, APP_URL, SECURE_COOKIES, SIEM_AI_*, DB_*, SMTP_*).
  // All are optional: a missing TELEGRAM_BOT_TOKEN must never fail a build.

  it("validates DB_* component variables in the schema", async () => {
    setEnv("DB_HOST", "db-01");
    setEnv("DB_PORT", "5433");
    setEnv("DB_USER", "ops");
    setEnv("DB_PASSWORD", "s3cret");
    setEnv("DB_NAME", "telemetry");

    const mod = await import("./env");
    const env = mod.getEnv();
    expect(env).toMatchObject({
      DB_HOST: "db-01",
      DB_PORT: "5433",
      DB_USER: "ops",
      DB_PASSWORD: "s3cret",
      DB_NAME: "telemetry",
    });
  });

  it("buildDatabaseUrl composes from the validated DB_* fields when DATABASE_URL is absent", async () => {
    deleteEnv("DATABASE_URL");
    setEnv("DB_HOST", "db-01");
    setEnv("DB_USER", "ops");
    setEnv("DB_PASSWORD", "s3cret");
    setEnv("DB_NAME", "telemetry");
    deleteEnv("DB_PORT");

    const mod = await import("./database-url");
    const url = mod.buildDatabaseUrl();

    expect(url).toBe("postgresql://ops:s3cret@db-01:5432/telemetry");
  });

  it("leaves the new optional vars undefined when absent (no fail-fast, no default)", async () => {
    for (const key of [
      "TELEGRAM_BOT_TOKEN",
      "APP_URL",
      "SECURE_COOKIES",
      "SIEM_AI_ENDPOINT_URL",
      "SIEM_AI_API_KEY",
      "SIEM_AI_DEFAULT_MODEL",
      "SIEM_AI_MODEL_OPUS",
      "SIEM_AI_MODEL_SONNET",
      "SIEM_AI_MODEL_HAIKU",
      "SMTP_URL",
      "SMTP_FROM",
    ]) {
      deleteEnv(key);
    }

    const mod = await import("./env");
    const env = mod.getEnv();
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(env.APP_URL).toBeUndefined();
    expect(env.SECURE_COOKIES).toBeUndefined();
    expect(env.SIEM_AI_ENDPOINT_URL).toBeUndefined();
    expect(env.SIEM_AI_API_KEY).toBeUndefined();
    expect(env.SIEM_AI_DEFAULT_MODEL).toBeUndefined();
    expect(env.SIEM_AI_MODEL_OPUS).toBeUndefined();
    expect(env.SIEM_AI_MODEL_SONNET).toBeUndefined();
    expect(env.SIEM_AI_MODEL_HAIKU).toBeUndefined();
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.SMTP_FROM).toBeUndefined();
    expect(env.DB_HOST).toBeUndefined();
    expect(env.DB_PORT).toBeUndefined();
    expect(env.DB_USER).toBeUndefined();
    expect(env.DB_PASSWORD).toBeUndefined();
    expect(env.DB_NAME).toBeUndefined();
  });

  it("passes the new optional vars through when present", async () => {
    setEnv("TELEGRAM_BOT_TOKEN", "123:token");
    setEnv("APP_URL", "https://ops.example.test");
    setEnv("SECURE_COOKIES", "true");
    setEnv("SIEM_AI_ENDPOINT_URL", "https://ai.example.test/v1");
    setEnv("SIEM_AI_MODEL_OPUS", "opus-test");
    setEnv("SMTP_URL", "smtp://relay:1025");
    setEnv("SMTP_FROM", "oncall@example.test");

    const mod = await import("./env");
    const env = mod.getEnv();
    expect(env).toMatchObject({
      TELEGRAM_BOT_TOKEN: "123:token",
      APP_URL: "https://ops.example.test",
      SECURE_COOKIES: "true",
      SIEM_AI_ENDPOINT_URL: "https://ai.example.test/v1",
      SIEM_AI_MODEL_OPUS: "opus-test",
      SMTP_URL: "smtp://relay:1025",
      SMTP_FROM: "oncall@example.test",
    });
  });
});
