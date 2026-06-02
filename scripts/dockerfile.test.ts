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

  it("uses PostgreSQL 15 client binaries as the default backup and restore tools", () => {
    expect(dockerfile).toMatch(/COPY --from=postgres:15-alpine \S*\/pg_dump\s+\/usr\/local\/bin\/pg_dump/);
    expect(dockerfile).toMatch(/COPY --from=postgres:15-alpine \S*\/pg_restore\s+\/usr\/local\/bin\/pg_restore/);
    expect(dockerfile).toMatch(/COPY --from=postgres:15-alpine \S*\/psql\s+\/usr\/local\/bin\/psql/);
  });

  it("keeps PostgreSQL 17 pg_restore available for newer dump compatibility", () => {
    expect(dockerfile).toMatch(/apk add[^\n]*postgresql17-client/);
    expect(dockerfile).toContain("pg_restore17");
  });

  it("installs runtime libraries required by copied PostgreSQL client tools", () => {
    expect(dockerfile).toContain("libedit");
    expect(dockerfile).toContain("krb5-libs");
    expect(dockerfile).toContain("openldap");
    expect(dockerfile).toMatch(/apk add[^\n]*unzip/);
  });
});
