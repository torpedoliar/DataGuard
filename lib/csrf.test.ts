import { describe, expect, it } from "vitest";
import {
  verifyCsrfToken,
  getCsrfTokenFromRequest,
} from "./csrf";
import { generateCsrfToken } from "./csrf-token";

describe("generateCsrfToken", () => {
  it("returns a 64-character hex string", () => {
    const token = generateCsrfToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns a different token on each call", () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(a).not.toBe(b);
  });
});

describe("verifyCsrfToken", () => {
  it("returns true for matching tokens", () => {
    const token = generateCsrfToken();
    expect(verifyCsrfToken(token, token)).toBe(true);
  });

  it("returns false for mismatching tokens", () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(verifyCsrfToken(a, b)).toBe(false);
  });

  it("returns false when cookie token is missing", () => {
    const token = generateCsrfToken();
    expect(verifyCsrfToken(undefined, token)).toBe(false);
  });

  it("returns false when request token is missing", () => {
    const token = generateCsrfToken();
    expect(verifyCsrfToken(token, undefined)).toBe(false);
  });

  it("returns false when both tokens are missing", () => {
    expect(verifyCsrfToken(undefined, undefined)).toBe(false);
  });

  it("returns false for tokens of different lengths", () => {
    expect(verifyCsrfToken("a", "aa")).toBe(false);
    expect(verifyCsrfToken("a".repeat(64), "a".repeat(63))).toBe(false);
  });

  it("uses constant-time comparison (timingSafeEqual)", () => {
    // Smoke test: ensure implementation rejects adversarial inputs
    // consistently. Constant-time is verified by code review — the impl
    // delegates to Node's crypto.timingSafeEqual.
    const a = "0".repeat(64);
    const b = "f".repeat(64);
    const c = "0".repeat(63) + "f";
    expect(verifyCsrfToken(a, b)).toBe(false);
    expect(verifyCsrfToken(a, c)).toBe(false);
  });
});

describe("getCsrfTokenFromRequest", () => {
  it("extracts token from X-CSRF-Token header", () => {
    const token = generateCsrfToken();
    const headers = new Headers({ "x-csrf-token": token });
    expect(getCsrfTokenFromRequest({ headers })).toBe(token);
  });

  it("extracts token from formData when present", () => {
    const token = generateCsrfToken();
    const headers = new Headers();
    const formData = new FormData();
    formData.append("csrf_token", token);
    expect(getCsrfTokenFromRequest({ headers, formData })).toBe(token);
  });

  it("prefers header over formData when both present", () => {
    const headerToken = generateCsrfToken();
    const formToken = generateCsrfToken();
    const headers = new Headers({ "x-csrf-token": headerToken });
    const formData = new FormData();
    formData.append("csrf_token", formToken);
    expect(getCsrfTokenFromRequest({ headers, formData })).toBe(headerToken);
  });

  it("returns null if neither header nor formData has the token", () => {
    const headers = new Headers();
    expect(getCsrfTokenFromRequest({ headers })).toBeNull();
    const formData = new FormData();
    formData.append("other", "value");
    expect(getCsrfTokenFromRequest({ headers, formData })).toBeNull();
  });

  it("returns null when request has no formData and no header", () => {
    const headers = new Headers();
    expect(getCsrfTokenFromRequest({ headers })).toBeNull();
  });
});
