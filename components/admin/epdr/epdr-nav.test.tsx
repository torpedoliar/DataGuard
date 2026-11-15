import { describe, expect, it, vi } from "vitest";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
import EpdrNav from "./epdr-nav";
describe("EPDR navigation", () => {
  it("does not expose admin operations to staff by default", () => {
    expect(EpdrNav().props.items.map((item: { href: string }) => item.href)).toEqual(["/admin/epdr", "/admin/epdr/threats"]);
  });
  it("exposes fleet, threats, playbooks and settings using shared subnav", () => {
    const nav = EpdrNav({ isAdmin: true });
    expect(nav.props.items.map((item: { href: string }) => item.href)).toEqual(["/admin/epdr", "/admin/epdr/threats", "/admin/epdr/playbooks", "/admin/epdr/approvals", "/admin/epdr/activity", "/admin/epdr/settings"]);
    expect(nav.props.items[0].exact).toBe(true);
    expect(nav.props.label).toBe("label");
  });
});
