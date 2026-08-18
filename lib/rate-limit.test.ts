import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, getClientIp, __resetRateLimitBuckets } from "./rate-limit";

describe("getClientIp", () => {
  it("prefers X-Real-IP over X-Forwarded-For", () => {
    expect(getClientIp("203.0.113.7, 10.0.0.1", "198.51.100.9")).toBe("198.51.100.9");
  });

  it("takes the LAST X-Forwarded-For entry (trusted-proxy-appended), not the first", () => {
    // The first entry is attacker-controlled; the last is proxy-appended.
    expect(getClientIp("203.0.113.7, 10.0.0.1", null)).toBe("10.0.0.1");
  });

  it("handles a single X-Forwarded-For entry", () => {
    expect(getClientIp("198.51.100.9", null)).toBe("198.51.100.9");
  });

  it("uses X-Real-IP even when X-Forwarded-For is absent", () => {
    expect(getClientIp(null, "198.51.100.9")).toBe("198.51.100.9");
  });

  it("trims whitespace around entries", () => {
    expect(getClientIp(" 203.0.113.7 ,  198.51.100.9 ", null)).toBe("198.51.100.9");
    expect(getClientIp(null, "  198.51.100.9  ")).toBe("198.51.100.9");
  });

  it("returns null when no trusted header is present", () => {
    expect(getClientIp(null, null)).toBe(null);
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => {
    __resetRateLimitBuckets();
  });

  it("allows the first call", () => {
    const result = checkRateLimit("login", "1.2.3.4", { windowMs: 60_000, max: 5 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.resetMs).toBeGreaterThan(0);
  });

  it("allows the 5th call", () => {
    const config = { windowMs: 60_000, max: 5 };
    for (let i = 0; i < 4; i++) {
      const r = checkRateLimit("login", "1.2.3.4", config);
      expect(r.allowed).toBe(true);
    }
    const fifth = checkRateLimit("login", "1.2.3.4", config);
    expect(fifth.allowed).toBe(true);
    expect(fifth.remaining).toBe(0);
  });

  it("rejects the 6th call within the window", () => {
    const config = { windowMs: 60_000, max: 5 };
    for (let i = 0; i < 5; i++) {
      checkRateLimit("login", "1.2.3.4", config);
    }
    const sixth = checkRateLimit("login", "1.2.3.4", config);
    expect(sixth.allowed).toBe(false);
    expect(sixth.remaining).toBe(0);
  });

  it("resets after the window has passed", async () => {
    const config = { windowMs: 50, max: 5 };
    for (let i = 0; i < 5; i++) {
      checkRateLimit("login", "1.2.3.4", config);
    }
    const blocked = checkRateLimit("login", "1.2.3.4", config);
    expect(blocked.allowed).toBe(false);

    // Wait past the short window
    await new Promise((resolve) => setTimeout(resolve, 80));

    const allowed = checkRateLimit("login", "1.2.3.4", config);
    expect(allowed.allowed).toBe(true);
    expect(allowed.remaining).toBe(4);
  });

  it("isolates keys from each other", () => {
    const config = { windowMs: 60_000, max: 2 };
    expect(checkRateLimit("login", "ip-a", config).allowed).toBe(true);
    expect(checkRateLimit("login", "ip-a", config).allowed).toBe(true);
    expect(checkRateLimit("login", "ip-a", config).allowed).toBe(false);

    // ip-b is untouched
    expect(checkRateLimit("login", "ip-b", config).allowed).toBe(true);
    expect(checkRateLimit("login", "ip-b", config).allowed).toBe(true);
    expect(checkRateLimit("login", "ip-b", config).allowed).toBe(false);
  });
});
