import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, dependencies: undefined as unknown[] | undefined,
  cleanup: undefined as (() => void) | undefined, busy: false, pending: Promise.resolve(),
  list: vi.fn(), detail: vi.fn(), start: vi.fn(), resume: vi.fn(), request: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => {
      state.values[index] = typeof value === "function" ? value(state.values[index]) : value;
    }];
  },
  useEffect: (run: () => () => void, dependencies: unknown[]) => {
    if (!state.dependencies || dependencies.some((value, index) => !Object.is(value, state.dependencies?.[index]))) {
      state.cleanup?.(); state.dependencies = dependencies; state.cleanup = run();
    }
  },
  useTransition: () => [state.busy, (run: () => Promise<void>) => {
    state.busy = true; state.pending = run().finally(() => { state.busy = false; });
  }],
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/actions/epdr-local-playbooks", () => ({ getEpdrLocalPlaybookRuns: state.list,
  getEpdrLocalPlaybookRun: state.detail, startEpdrLocalPlaybook: state.start, resumeEpdrLocalPlaybook: state.resume }));
vi.mock("@/actions/epdr-local-approvals", () => ({ requestEpdrLocalApproval: state.request }));
import LocalPlaybookRunner from "./local-playbook-runner";
function render() { state.cursor = 0; return LocalPlaybookRunner(); }
function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children)];
}
function click(name: string) {
  const target = elements(render()).find((node) => node.type === "button" && node.props.children === name)!;
  if (!target.props.disabled) (target.props.onClick as () => void)();
}
async function settle() { await Promise.resolve(); await Promise.resolve(); }
const run = { id: 7, versionId: 1, detectionId: 2, status: "pending", createdAt: "2026-01-01", finishedAt: null };
beforeEach(() => {
  vi.resetAllMocks(); state.values = []; state.cursor = 0; state.dependencies = undefined; state.cleanup = undefined;
  state.busy = false; state.pending = Promise.resolve();
  state.list.mockResolvedValue({ rows: [run], total: 1, limit: 50 });
  state.detail.mockResolvedValue({ ...run, steps: [] });
  state.resume.mockResolvedValue({ runId: 7, result: "finished" });
  state.request.mockResolvedValue({ approvalId: 21, existing: false });
});
afterEach(() => state.cleanup?.());
describe("local review runner interactions", () => {
  it("loads evidence only on inspection, never starts or resumes on mount", async () => {
    render(); await settle();
    expect(state.list).toHaveBeenCalledOnce();
    expect(state.detail).not.toHaveBeenCalled(); expect(state.start).not.toHaveBeenCalled(); expect(state.resume).not.toHaveBeenCalled();
  });
  it("refreshes both list and detail after explicit resume", async () => {
    render(); await settle(); click("inspect"); await state.pending;
    state.detail.mockResolvedValue({ ...run, status: "finished", steps: [] });
    state.list.mockResolvedValue({ rows: [{ ...run, status: "finished" }], total: 1, limit: 50 });
    click("resume"); await state.pending; render(); await settle();
    expect(state.resume).toHaveBeenCalledExactlyOnceWith(7);
    expect(state.detail).toHaveBeenCalledTimes(2); expect(state.list).toHaveBeenCalledTimes(2);
    expect(elements(render()).some((node) => node.props.children === "status.finished")).toBe(true);
  });
  it("shows initial load failure rather than permanent loading and supports retry", async () => {
    state.list.mockRejectedValueOnce(new Error("private")); render(); await settle();
    expect(elements(render()).some((node) => node.props.role === "alert")).toBe(true);
    expect(elements(render()).some((node) => node.props.children === "loading")).toBe(false);
    click("refresh"); render(); await settle();
    expect(state.list).toHaveBeenCalledTimes(2);
    expect(elements(render()).some((node) => node.props.role === "alert")).toBe(false);
  });
  it("requests a local approval only for an intent the saved review proposed", async () => {
    state.detail.mockResolvedValue({ ...run, steps: [], evidence: {
      responsePolicy: { status: "proposed" }, definition: { template: { steps: ["review", "incident", "scan"] } },
    } });
    render(); await settle(); click("inspect"); await state.pending;
    expect(elements(render()).some((node) => node.type === "button" && node.props.children === "request_scan")).toBe(true);
    expect(elements(render()).some((node) => node.type === "button" && node.props.children === "request_isolate")).toBe(false);
    click("request_scan"); await state.pending;
    expect(state.request).toHaveBeenCalledExactlyOnceWith({ runId: 7, actionIntent: "scan", confirmLocalApproval: true });
    expect(elements(render()).some((node) => node.props.children === "approvalRequested")).toBe(true);
  });
  it("shows no approval controls for a blocked review", async () => {
    state.detail.mockResolvedValue({ ...run, steps: [], evidence: {
      responsePolicy: { status: "blocked" }, definition: { template: { steps: ["review", "scan"] } },
    } });
    render(); await settle(); click("inspect"); await state.pending;
    expect(elements(render()).some((node) => node.type === "button" && node.props.children === "request_scan")).toBe(false);
  });
  it("clears stale details when inspection fails", async () => {
    render(); await settle(); click("inspect"); await state.pending;
    state.detail.mockResolvedValueOnce({ message: "unavailable" });
    click("inspect"); await state.pending;
    expect(elements(render()).some((node) => node.type === "button" && node.props.children === "resume")).toBe(false);
  });
  it("pages the run list, mirrors a clamped page and leaves detail untouched", async () => {
    state.list.mockResolvedValue({ rows: [run], total: 120, limit: 50, page: 1, pages: 3 });
    render(); await settle();
    expect(state.list).toHaveBeenLastCalledWith({ page: 1 });
    expect(elements(render()).some((node) => node.props.children === "pageSummary")).toBe(true);
    state.list.mockResolvedValue({ rows: [run], total: 120, limit: 50, page: 2, pages: 3 });
    click("next"); render(); await settle();
    expect(state.list).toHaveBeenLastCalledWith({ page: 2 });
    state.list.mockResolvedValue({ rows: [run], total: 120, limit: 50, page: 3, pages: 3 });
    click("next"); render(); await settle();
    expect(state.list).toHaveBeenLastCalledWith({ page: 3 });
    const next = elements(render()).find((node) => node.type === "button" && node.props.children === "next")!;
    expect(next.props.disabled).toBe(true);
    expect(state.detail).not.toHaveBeenCalled();
    expect(state.resume).not.toHaveBeenCalled();
  });
});
