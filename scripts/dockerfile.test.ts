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

  it("pins postgresql client to v15 to match the server image", () => {
    expect(dockerfile).toMatch(/apk add[^\n]*postgresql15-client[^\n]*unzip/);
    expect(dockerfile).not.toMatch(/apk add[^\n]* postgresql-client/);
  });
});
