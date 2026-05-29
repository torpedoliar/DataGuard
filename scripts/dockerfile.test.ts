import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Dockerfile image export safety", () => {
  const dockerfile = readFileSync(join(process.cwd(), "Dockerfile"), "utf8");

  it("does not recursively chown the full application directory", () => {
    expect(dockerfile).not.toContain("chown -R nextjs:nodejs /app");
  });

  it("extracts build tarballs after switching to the non-root app user", () => {
    const userIndex = dockerfile.indexOf("USER nextjs");
    const extractIndex = dockerfile.indexOf("tar -xf standalone.tar");

    expect(userIndex).toBeGreaterThan(-1);
    expect(extractIndex).toBeGreaterThan(userIndex);
  });

  it("uses pg client binaries from postgres:15-alpine to match the server", () => {
    expect(dockerfile).toMatch(/COPY --from=postgres:15-alpine \S*\/pg_dump/);
    expect(dockerfile).toMatch(/COPY --from=postgres:15-alpine \S*\/pg_restore/);
    expect(dockerfile).toMatch(/COPY --from=postgres:15-alpine \S*\/psql/);
    expect(dockerfile).toMatch(/COPY --from=postgres:15-alpine \S*\/libpq\.so/);
    expect(dockerfile).not.toMatch(/apk add[^\n]*postgresql\d*-client/);
    expect(dockerfile).not.toMatch(/apk add[^\n]* postgresql-client/);
  });

  it("installs unzip for the restore route", () => {
    expect(dockerfile).toMatch(/apk add[^\n]*unzip/);
  });
});
