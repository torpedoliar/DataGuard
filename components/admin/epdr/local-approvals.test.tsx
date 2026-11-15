import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({
  values: [] as unknown[], cursor: 0, dependencies: undefined as unknown[] | undefined,
  cleanup: undefined as (() => void) | undefined, busy: false, pending: Promise.resolve(),
  list: vi.fn(), decide: vi.fn(),
}));
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
vi.mock("@/actions/epdr-local-approvals", () => ({ getEpdrLocalApprovals: state.list, decideEpdrLocalApproval: state.decide }));

import LocalApprovals from "./local-approvals";

function render() { state.cursor = 0; return LocalApprovals(); }
function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children)];
}
function button(tree: ReactElement, name: string) {
  return elements(tree).find((node) => node.type === "button" && node.props.children === name)!;
}
function click(tree: ReactElement, name: string) {
  const target = button(tree, name);
  if (!target.props.disabled) (target.props.onClick as () => void)();
}
async function settle() { await Promise.resolve(); await Promise.resolve(); }
const row = {
  id: 11, localRunId: 7, detectionId: 31, endpointId: 5, actionIntent: "scan" as const,
  status: "pending" as const, requestedBy: 8, decidedBy: null, decidedAt: null,
  decisionNote: null, expiresAt: "2026-01-02T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  state.values = []; state.cursor = 0; state.dependencies = undefined; state.cleanup = undefined;
  state.busy = false; state.pending = Promise.resolve();
  state.list.mockResolvedValue({ rows: [row], total: 1, limit: 50, pending: 1 });
  state.decide.mockResolvedValue({ approvalId: 11, status: "approved", providerExecution: "blocked_read_only" });
});
afterEach(() => state.cleanup?.());

describe("local approvals panel", () => {
  it("loads requests on mount and states that approval never dispatches", async () => {
    render(); await settle();
    const nodes = elements(render());
    expect(state.list).toHaveBeenCalledOnce();
    expect(nodes.some((node) => node.props.role === "note" && node.props.children === "readOnly")).toBe(true);
    expect(nodes.some((node) => node.props.children === "row")).toBe(true);
    expect(nodes.some((node) => node.props.children === "status.pending")).toBe(true);
  });

  it("approves with the typed note and refreshes the list", async () => {
    render(); await settle();
    const input = elements(render()).find((node) => node.type === "input")!;
    (input.props.onChange as (event: unknown) => void)({ target: { value: " checked " } });
    click(render(), "approve");
    await state.pending;
    expect(state.decide).toHaveBeenCalledExactlyOnceWith({ approvalId: 11, decision: "approve", note: "checked" });
    expect(elements(render()).some((node) => node.props.children === "feedback.approved")).toBe(true);
    await settle();
    expect(state.list).toHaveBeenCalledTimes(2);
  });

  it("rejects without a note and shows a safe error for refused decisions", async () => {
    render(); await settle();
    click(render(), "reject"); await state.pending;
    expect(state.decide).toHaveBeenCalledWith({ approvalId: 11, decision: "reject", note: undefined });
    state.decide.mockResolvedValueOnce({ message: "Approval expired." });
    click(render(), "approve"); await state.pending;
    expect(elements(render()).some((node) => node.props.role === "alert" && node.props.children === "error")).toBe(true);
    expect(JSON.stringify(render())).not.toContain("Approval expired.");
  });

  it("never shows decision controls for approved or expired rows", async () => {
    state.list.mockResolvedValue({
      rows: [{ ...row, id: 12, status: "approved" }, { ...row, id: 13, status: "expired" }],
      total: 2, limit: 50, pending: 0,
    });
    render(); await settle();
    const nodes = elements(render());
    expect(nodes.filter((node) => node.type === "input")).toHaveLength(0);
    expect(nodes.filter((node) => node.type === "button" && (node.props.children === "approve" || node.props.children === "reject"))).toHaveLength(0);
    expect(nodes.some((node) => node.props.children === "approvedNote")).toBe(true);
  });
});
