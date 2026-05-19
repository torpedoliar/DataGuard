import { describe, expect, it } from "vitest";
import {
  canManageActiveSite,
  canManageGlobalReferenceData,
  canManageGlobalSettings,
  canManageGlobalUsers,
  canSubmitChecklist,
} from "./permissions";

describe("permissions", () => {
  it("limits global user administration to superadmin", () => {
    expect(canManageGlobalUsers("superadmin")).toBe(true);
    expect(canManageGlobalUsers("admin")).toBe(false);
    expect(canManageGlobalUsers("staff")).toBe(false);
  });

  it("limits global settings and reference data to superadmin", () => {
    expect(canManageGlobalSettings("superadmin")).toBe(true);
    expect(canManageGlobalSettings("admin")).toBe(false);
    expect(canManageGlobalReferenceData("superadmin")).toBe(true);
    expect(canManageGlobalReferenceData("staff")).toBe(false);
  });

  it("allows active-site management for superadmin or site admin only", () => {
    expect(canManageActiveSite("superadmin", undefined)).toBe(true);
    expect(canManageActiveSite("admin", "admin")).toBe(true);
    expect(canManageActiveSite("admin", "staff")).toBe(false);
    expect(canManageActiveSite("staff", "staff")).toBe(false);
  });

  it("requires an active site before checklist submission", () => {
    expect(canSubmitChecklist(1)).toBe(true);
    expect(canSubmitChecklist(null)).toBe(false);
    expect(canSubmitChecklist(undefined)).toBe(false);
  });
});
