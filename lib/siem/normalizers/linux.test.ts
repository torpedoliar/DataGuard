import { describe, expect, it } from "vitest";
import { normalizeLinux } from "./linux";

describe("normalizeLinux", () => {
  it("detects sudo command", () => {
    expect(normalizeLinux("sudo: admin : TTY=pts/0 ; PWD=/home/admin ; USER=root ; COMMAND=/bin/su")).toMatchObject({
      normalizedType: "sudo_command",
      username: "admin",
      metadata: { command: "/bin/su" }
    });
  });

  it("detects oom killer", () => {
    expect(normalizeLinux("kernel: Out of memory: Kill process 1234")).toMatchObject({
      normalizedType: "oom_killer",
      category: "System"
    });
  });
});
