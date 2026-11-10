import { describe, expect, it } from "vitest";
import { mapHttpStatusToKind, redactWatchGuard, WatchGuardError } from "./errors";

describe("redactWatchGuard", () => {
  it("removes known secret values", () => {
    const text = `auth failed for password=s3cr3t-password and apiKey=pre-shared-api-key token=eyJhbGciOi.fake`;
    const out = redactWatchGuard(text, {
      password: "s3cr3t-password",
      apiKey: "pre-shared-api-key",
      token: "eyJhbGciOi.fake",
    });
    expect(out).not.toContain("s3cr3t-password");
    expect(out).not.toContain("pre-shared-api-key");
    expect(out).not.toContain("eyJhbGciOi.fake");
    expect(out).toContain("[REDACTED]");
  });

  it("strips Authorization Bearer/Basic headers", () => {
    const out = redactWatchGuard("Authorization: Bearer abc123 rest", {});
    expect(out).not.toContain("abc123");
    expect(out).toContain("[REDACTED]");
  });

  it("strips <token-name>=<value> shapes", () => {
    const out = redactWatchGuard('{"access_token":"tok-value"} api_key=key-value', {});
    expect(out).not.toContain("tok-value");
    expect(out).not.toContain("key-value");
  });

  it("is a no-op for empty secrets and empty text", () => {
    expect(redactWatchGuard("", { password: "x" })).toBe("");
    expect(redactWatchGuard("keep-me", { password: "", apiKey: "" })).toBe("keep-me");
  });
});

describe("mapHttpStatusToKind", () => {
  it("maps 400/401 → auth, 403 → forbidden, 404 → not_found, 429 → rate_limited, 5xx → server", () => {
    expect(mapHttpStatusToKind(400)).toBe("auth");
    expect(mapHttpStatusToKind(401)).toBe("auth");
    expect(mapHttpStatusToKind(403)).toBe("forbidden");
    expect(mapHttpStatusToKind(404)).toBe("not_found");
    expect(mapHttpStatusToKind(429)).toBe("rate_limited");
    expect(mapHttpStatusToKind(503)).toBe("server");
    expect(mapHttpStatusToKind(422)).toBe("invalid_response");
  });
});

describe("WatchGuardError", () => {
  it("carries kind, status, outcomeUnknown and retryAfterMs", () => {
    const err = new WatchGuardError("server", "boom", { status: 503, retryAfterMs: 2000 });
    expect(err.name).toBe("WatchGuardError");
    expect(err.kind).toBe("server");
    expect(err.status).toBe(503);
    expect(err.outcomeUnknown).toBe(false);
    expect(err.retryAfterMs).toBe(2000);
  });
});