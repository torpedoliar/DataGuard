import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { EpdrOverview } from "@/actions/epdr-overview";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import OperationsOverview from "./operations-overview";

const data: EpdrOverview = {
  siteName: "Site", connection: "live", lastSyncAt: new Date(), lastSyncError: null,
  isAdmin: true, isSuperadmin: false, accountRevision: 1, writeEnabled: false, available: true,
  sources: [{ source: "inventory", state: "current", lastSyncAt: new Date() },
    { source: "detections", state: "partial", lastSyncAt: null }, { source: "provider", state: "stale", lastSyncAt: null }],
  counts: { total: 1500, protected: 1400, disabled: 5, error: 2, install_error: 0, no_license: 1,
    outdated: 50, unknown: 42, offline: 2, unknown_contact: 5, threats: 12, highScore: 3, pending: 2, review: 1 },
};
describe("operations overview", () => {
  it("renders full totals and distinct source health without asserting safety", () => {
    const html = renderToStaticMarkup(<OperationsOverview data={data} locale="en" />);
    expect(html).toContain("1,500");
    expect(html).toContain("states.partial");
    expect(html).toContain("states.stale");
    expect(html).toContain("confidenceDescription");
    expect(html).toContain("currentBinding");
    expect(html).toContain("/admin/epdr/endpoints?filter=disabled");
    expect(html).toContain("/admin/epdr/threats?scoreMode=range");
    // Review and pending are provider-request state groups on the Actions page.
    expect(html).toContain("/admin/epdr/approvals?group=review");
    expect(html).toContain("/admin/epdr/approvals?group=approval");
    expect(html.indexOf("queue.highScore")).toBeLessThan(html.indexOf("queue.disabled"));
  });
  it("hides administrator work links from staff", () => {
    const html = renderToStaticMarkup(<OperationsOverview data={{ ...data, isAdmin: false }} locale="en" />);
    expect(html).not.toContain("/admin/epdr/approvals");
    expect(html).not.toContain("/admin/epdr/activity");
    expect(html).toContain("queue.highScore");
  });
  it("renders unavailable rather than zero counts on incomplete reads", () => {
    const html = renderToStaticMarkup(<OperationsOverview data={{ ...data, available: false, counts: null }} locale="en" />);
    expect(html).toContain("unavailable");
    expect(html).not.toContain("metricsLabels");
  });
  it("does not label an empty queue as safe", () => {
    const counts = Object.fromEntries(Object.keys(data.counts!).map((key) => [key, 0])) as EpdrOverview["counts"];
    const html = renderToStaticMarkup(<OperationsOverview data={{ ...data, counts }} locale="en" />);
    expect(html).toContain("emptyQueue");
    expect(html).toContain("confidenceDescription");
  });
});
