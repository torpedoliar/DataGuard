import { describe, expect, it } from "vitest";
import { getAppNavigation } from "./navigation";

describe("app navigation", () => {
  it("shows operator and resolve groups to staff", () => {
    const groups = getAppNavigation("staff");
    expect(groups.map((group) => group.label)).toEqual(["Operate", "Resolve"]);
    expect(groups.flatMap((group) => group.items.map((item) => item.href))).toContain("/audit/new");
    expect(groups.flatMap((group) => group.items.map((item) => item.href))).not.toContain("/admin/users");
  });

  it("shows admin management items to admins", () => {
    const hrefs = getAppNavigation("admin").flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toContain("/admin");
    expect(hrefs).toContain("/admin/incidents");
    expect(hrefs).not.toContain("/admin/sites");
  });

  it("shows global management items to superadmins", () => {
    const hrefs = getAppNavigation("superadmin").flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toContain("/admin/users");
    expect(hrefs).toContain("/admin/sites");
    expect(hrefs).toContain("/admin/settings");
    expect(hrefs).toContain("/admin/update");
  });
});
