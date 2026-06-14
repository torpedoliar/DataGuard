import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock pg before importing the route
const mockQuery = vi.fn();
const mockEnd = vi.fn().mockResolvedValue(undefined);

vi.mock("pg", () => {
  class Pool {
    query: (...args: unknown[]) => unknown;
    end: () => Promise<unknown>;
    constructor() {
      this.query = (...args: unknown[]) => mockQuery(...args);
      this.end = () => mockEnd();
    }
  }
  return { Pool };
});

vi.mock("@/lib/database-url", () => ({
  buildDatabaseUrl: () => "postgresql://test:test@localhost:5432/dccheck",
}));

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockEnd.mockReset();
    mockEnd.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with status=ok and db=ok when DB query succeeds", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
    // Must end the pool even on success
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it("returns 503 with status=degraded and db=down when DB query fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection refused"));

    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.db).toBe("down");
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("connection refused");
    // Must end the pool even on failure
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it("calls pool.end() on both success and failure paths", async () => {
    // success path
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const okRes = await GET();
    expect(okRes.status).toBe(200);
    expect(mockEnd).toHaveBeenCalledTimes(1);

    // failure path
    mockQuery.mockRejectedValueOnce(new Error("boom"));
    const failRes = await GET();
    expect(failRes.status).toBe(503);
    expect(mockEnd).toHaveBeenCalledTimes(2);
  });

  it("still returns 503 even if pool.end() throws", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    mockEnd.mockRejectedValueOnce(new Error("end failed"));

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.db).toBe("down");
  });
});
