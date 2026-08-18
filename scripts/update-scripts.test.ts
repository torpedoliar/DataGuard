import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production update scripts", () => {
  // The deploy scripts deliberately run the migration flow (`npm run
  // db:migrate` → drizzle-kit migrate) instead of `drizzle-kit push`, because
  // push would mutate the live DB schema without a recorded migration.
  it.each(["update.ps1", "update.sh"])("applies schema via the migration flow in %s", (scriptName) => {
    const script = readFileSync(join(process.cwd(), scriptName), "utf8");

    expect(script).toContain("npm run db:migrate");
    expect(script).not.toContain("drizzle-kit push");
  });

  it.each(["update.ps1", "update.sh"])("backs up through the named Postgres container fallback in %s", (scriptName) => {
    const script = readFileSync(join(process.cwd(), scriptName), "utf8");

    expect(script).toContain("dccheck_postgres");
    expect(script).toContain("docker inspect");
    expect(script).toContain("docker exec");
    expect(script).toContain("pg_dump");
  });
});
