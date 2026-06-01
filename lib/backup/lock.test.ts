import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acquireLock, releaseLock } from "./lock";

describe("backup lock", () => {
  it("acquires when free and rejects when held", () => {
    const root = mkdtempSync(path.join(tmpdir(), "dccheck-lock-"));
    const file = path.join(root, "lock");
    expect(acquireLock(file)).toBe(true);
    expect(acquireLock(file)).toBe(false);
    releaseLock(file);
    expect(acquireLock(file)).toBe(true);
    releaseLock(file);
    rmSync(root, { recursive: true, force: true });
  });
});
