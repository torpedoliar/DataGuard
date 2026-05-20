import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production update scripts", () => {
  it.each(["update.ps1", "update.sh"])("syncs schema with Drizzle push in %s", (scriptName) => {
    const script = readFileSync(join(process.cwd(), scriptName), "utf8");

    expect(script).toContain("drizzle-kit push");
    expect(script).not.toContain("npm run db:migrate");
  });

  it.each(["update.ps1", "update.sh"])("backs up through the named Postgres container fallback in %s", (scriptName) => {
    const script = readFileSync(join(process.cwd(), scriptName), "utf8");

    expect(script).toContain("dccheck_postgres");
    expect(script).toContain("docker inspect");
    expect(script).toContain("docker exec");
    expect(script).toContain("pg_dump");
  });
});
