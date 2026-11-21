import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, dependencies: undefined as unknown[] | undefined, cleanup: undefined as (() => void) | undefined, load: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => { state.values[index] = typeof value === "function" ? value(state.values[index]) : value; }];
  },
  useEffect: (run: () => () => void, dependencies: unknown[]) => {
    if (!state.dependencies || dependencies.some((value, index) => value !== state.dependencies?.[index])) {
      state.cleanup?.(); state.dependencies = dependencies; state.cleanup = run();
    }
  },
}));
vi.mock("next-intl", () => ({ useLocale: () => "id", useTranslations: () => (key: string) => key }));
vi.mock("@/actions/epdr-operations", () => ({ getEpdrOperations: state.load }));
vi.mock("./time-zone-provider", () => ({ useEpdrTimeZone: () => ({ timeZone: "Asia/Jakarta" }) }));
import OperationsLedgerPanel from "./operations-ledger";
function render(view: "activity" | "approvals" = "activity") { state.cursor = 0; return OperationsLedgerPanel({ view }); }
function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const item = node as ReactElement<Record<string, unknown>>;
  return [item, ...elements(item.props.children)];
}
/** Link is a client reference proxy; serializing the tree itself would recurse. */
function strings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(strings);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return strings((node as ReactElement<Record<string, unknown>>).props.children);
}
function click(tree: ReactElement, name: string) {
  const target = elements(tree).find((item) => item.type === "button" && item.props.children === name)!;
  if (!target.props.disabled) (target.props.onClick as () => void)();
}
async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
const ledger = { view: "activity", page: 1, total: 51, limit: 50, providerLocked: true, rows: [{ id: 1, kind: "action", status: "pending", action: "scan", createdAt: "2026-01-01T00:00:00Z" }] };
beforeEach(() => {
  state.cleanup?.(); state.values = []; state.cursor = 0; state.dependencies = undefined; state.cleanup = undefined;
  vi.resetAllMocks(); state.load.mockResolvedValue(ledger);
});

describe("read-only operations UI", () => {
  it("keeps the read-only notice visible while loading, on failure, and when empty", async () => {
    state.load.mockResolvedValue({ message: "secret backend detail" });
    expect(JSON.stringify(render())).toContain("readOnly");
    await settle();
    const failed = render();
    expect(JSON.stringify(failed)).toContain("readOnly");
    expect(JSON.stringify(failed)).not.toContain("secret backend detail");
    expect(elements(failed).some((item) => item.props.role === "alert")).toBe(true);
    state.load.mockResolvedValue({ ...ledger, rows: [], total: 0 });
    click(failed, "refresh"); render(); await settle();
    expect(JSON.stringify(render())).toContain("empty");
    expect(JSON.stringify(render())).toContain("readOnly");
  });

  it("shows recorded intentions with no approval or dispatch controls", async () => {
    render("approvals"); await settle(); const tree = render("approvals");
    expect(state.load).toHaveBeenCalledWith({ view: "approvals", page: 1 });
    expect(JSON.stringify(tree)).toContain("activityHint");
    expect(JSON.stringify(tree)).toContain("actions.scan");
    expect(elements(tree).filter((item) => item.type === "button").map((item) => item.props.children)).toEqual(["apply", "refresh", "previous", "next"]);
  });

  it("pages in bounded requests, suppressing stale rows during navigation", async () => {
    render(); await settle(); const tree = render();
    click(tree, "previous"); expect(state.load).toHaveBeenCalledTimes(1);
    click(tree, "next");
    expect(JSON.stringify(render())).not.toContain("actions.scan");
    expect(state.load).toHaveBeenLastCalledWith({ view: "activity", page: 2 });
    await settle(); render();
  });

  it("applies server filters and resets pagination without browser filtering", async () => {
    render(); await settle(); let tree = render();
    click(tree, "next"); render(); await settle(); tree = render();
    const kind = elements(tree).find((item) => item.type === "select")!;
    (kind.props.onChange as (event: unknown) => void)({ target: { value: "localRun" } });
    tree = render();
    const form = elements(tree).find((item) => item.type === "form")!;
    (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
    render();
    expect(state.load).toHaveBeenLastCalledWith({ view: "activity", page: 1, kind: "localRun" });
  });

  it("marks retained records stale after a refresh error", async () => {
    render(); await settle(); const tree = render();
    state.load.mockRejectedValue(new Error("secret"));
    click(tree, "refresh");
    expect(JSON.stringify(render())).toContain("loading");
    await settle();
    const failed = JSON.stringify(render());
    expect(failed).toContain("stale"); expect(failed).toContain("actions.scan");
    expect(failed).not.toContain("secret");
  });

  it("shows supported context links and accurate completed-record language", async () => {
    state.load.mockResolvedValue({ ...ledger, rows: [{ ...ledger.rows[0], status: "succeeded", context: { incidentId: 7, detectionId: 8, actionId: 1 } }] });
    render(); await settle(); const tree = render();
    expect(strings(tree)).toContain("completedRecord");
    expect(strings(tree)).toContain("outcomeNotice");
    expect(elements(tree).filter((item) => item.props.href).map((item) => item.props.href)).toEqual(["/id/admin/incidents/7", "/id/admin/epdr/playbooks?detection=8"]);
    const time = elements(tree).find((item) => item.type === "time")!;
    expect(time.props.children).toBe(new Date("2026-01-01T00:00:00Z").toLocaleString("id", { timeZone: "Asia/Jakarta" }));
  });

  it("ignores an old response after switching the view", async () => {
    let complete!: (value: unknown) => void;
    state.load.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    render(); render("approvals"); await settle();
    complete({ ...ledger, rows: [{ ...ledger.rows[0], action: "repair" }] });
    await settle();
    expect(JSON.stringify(render("approvals"))).not.toContain("actions.repair");
  });
});
