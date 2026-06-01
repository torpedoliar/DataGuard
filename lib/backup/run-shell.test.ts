import { describe, expect, it } from "vitest";
import { runShell } from "./run-shell";

describe("runShell", () => {
  it("captures stdout and exit code on success", async () => {
    const result = await runShell("node", ["-e", "process.stdout.write('ok')"]);
    expect(result.code).toBe(0);
    expect(result.stdout.toString()).toBe("ok");
  });

  it("captures stderr and non-zero exit code on failure", async () => {
    const result = await runShell("node", ["-e", "process.stderr.write('boom'); process.exit(2)"]);
    expect(result.code).toBe(2);
    expect(result.stderr.toString()).toContain("boom");
  });
});
