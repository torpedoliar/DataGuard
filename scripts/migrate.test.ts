import { beforeEach, describe, expect, it, vi } from "vitest";

const migrateMock = vi.fn(async () => undefined);
const drizzleMock = vi.fn(() => ({}));
const endMock = vi.fn(async () => undefined);
const releaseMock = vi.fn();
let appliedMigrationCount = "0";
let latestMigrationCreatedAt: string | null = null;
const queryMock = vi.fn(async (query: string) => {
  if (query.includes("information_schema.tables") && query.includes("table_schema = $1")) {
    return { rows: [{ count: "1" }], rowCount: 1 };
  }

  if (query.includes('FROM "drizzle"."__drizzle_migrations"')) {
    if (query.includes("ORDER BY created_at DESC")) {
      return latestMigrationCreatedAt === null
        ? { rows: [], rowCount: 0 }
        : { rows: [{ created_at: latestMigrationCreatedAt }], rowCount: 1 };
    }

    return { rows: [{ count: appliedMigrationCount }], rowCount: 1 };
  }

  if (query.includes("information_schema.tables") && query.includes("table_schema = 'public'")) {
    return { rows: [], rowCount: 14 };
  }

  return { rows: [], rowCount: 0 };
});
const connectMock = vi.fn(async () => ({
  query: queryMock,
  release: releaseMock,
}));

vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: migrateMock,
}));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: drizzleMock,
}));

vi.mock("pg", () => ({
  Pool: vi.fn(function Pool() {
    return {
      connect: connectMock,
      end: endMock,
    };
  }),
}));

vi.mock("../lib/database-url", () => ({
  buildDatabaseUrl: () => "postgresql://user:pass@localhost:5432/db",
  redactDatabaseUrl: () => "postgresql://user:***@localhost:5432/db",
}));

describe("migration runner", () => {
  beforeEach(() => {
    appliedMigrationCount = "0";
    latestMigrationCreatedAt = null;
    vi.resetModules();
    migrateMock.mockClear();
    drizzleMock.mockClear();
    endMock.mockClear();
    releaseMock.mockClear();
    connectMock.mockClear();
    queryMock.mockClear();
  });

  it("marks baseline migration when migration table exists but has no rows", async () => {
    await import("./migrate");

    await vi.waitFor(() => expect(migrateMock).toHaveBeenCalledTimes(1));

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO \"drizzle\".\"__drizzle_migrations\""),
      expect.any(Array),
    );
  });

  it("marks baseline migration when latest applied migration predates the baseline", async () => {
    appliedMigrationCount = "1";
    latestMigrationCreatedAt = "1771859585713";

    await import("./migrate");

    await vi.waitFor(() => expect(migrateMock).toHaveBeenCalledTimes(1));

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO \"drizzle\".\"__drizzle_migrations\""),
      expect.any(Array),
    );
  });
});
