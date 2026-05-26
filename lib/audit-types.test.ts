import { describe, expect, it } from "vitest";
import type { AuditAction } from "./audit";

describe("AuditAction", () => {
  it("includes DOWNLOAD and RESTORE", () => {
    const download: AuditAction = "DOWNLOAD";
    const restore: AuditAction = "RESTORE";
    expect([download, restore]).toEqual(["DOWNLOAD", "RESTORE"]);
  });
});
