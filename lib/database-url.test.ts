import { describe, expect, it } from "vitest";
import { buildDatabaseUrl, redactDatabaseUrl } from "./database-url";

describe("database url helpers", () => {
  it("uses DATABASE_URL when provided", () => {
    expect(buildDatabaseUrl({
      DATABASE_URL: "postgresql://direct:secret@db:5432/app",
      DB_HOST: "ignored",
    })).toBe("postgresql://direct:secret@db:5432/app");
  });

  it("builds DATABASE_URL from component variables and encodes password", () => {
    expect(buildDatabaseUrl({
      DB_HOST: "db",
      DB_PORT: "5433",
      DB_USER: "administrator",
      DB_PASSWORD: "Arabika 19/27",
      DB_NAME: "dccheck",
    })).toBe("postgresql://administrator:Arabika%2019%2F27@db:5433/dccheck");
  });

  it("redacts password for logs", () => {
    expect(redactDatabaseUrl("postgresql://administrator:Arabika%2019%2F27@db:5433/dccheck"))
      .toBe("postgresql://administrator:***@db:5433/dccheck");
  });

  it("throws in strict mode when component variables are incomplete", () => {
    expect(() => buildDatabaseUrl({ DB_HOST: "db" }, { requireCompleteConfig: true }))
      .toThrow("Database connection not configured");
  });
});
