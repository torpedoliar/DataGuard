import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production update scripts", () => {
  it.each(["update.ps1", "update.sh"])("runs Drizzle migrations in %s", (scriptName) => {
    const script = readFileSync(join(process.cwd(), scriptName), "utf8");

    expect(script).toContain("npm run db:migrate");
    expect(script).not.toContain("drizzle-kit push");
  });
});
