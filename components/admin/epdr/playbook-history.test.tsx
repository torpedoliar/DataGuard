import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({
  values: [] as unknown[], cursor: 0,
  dependencies: undefined as unknown[] | undefined,
  cleanup: undefined as (() => void) | undefined,
  busy: false, pending: Promise.resolve(),
  history: vi.fn(), save: vi.fn(), record: vi.fn(),
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
      state.cleanup?.();
      state.dependencies = dependencies;
      state.cleanup = run();
    }
  },
  useTransition: () => [state.busy, (run: () => Promise<void>) => {
    state.busy = true;
    state.pending = run().finally(() => { state.busy = false; });
  }],
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key }));
vi.mock("@/actions/epdr-playbook-history", () => ({
  getEpdrPlaybookHistory: state.history,
  saveEpdrPlaybookVersion: state.save,
  recordEpdrPlaybookSimulation: state.record,
}));

import PlaybookHistory from "./playbook-history";

function render() { state.cursor = 0; return PlaybookHistory(); }
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
function change(node: ReactElement<Record<string, unknown>>, value: string) {
  (node.props.onChange as (event: unknown) => void)({ target: { value } });
}
function select(label: string) {
  const target = elements(render()).find((node) => node.type === "label" && Array.isArray(node.props.children) && node.props.children[0] === label)!;
  return elements(target).find((node) => node.type === "select")!;
}
function configureName() {
  change(elements(render()).find((node) => node.type === "input" && node.props.type !== "number")!, "Local IOA review");
}
function submit() {
  const tree = render();
  if (!button(tree, "save").props.disabled) {
    (elements(tree).find((node) => node.type === "form")!.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
  }
}
function snapshot() {
  return {
    limit: 50,
    versions: [{ id: 41, templateId: "ioa", name: "Saved IOA", version: 2, createdAt: "2026-01-02T12:00:00.000Z" }],
    runs: [{ id: 73, versionId: 41, status: "simulation_recorded" as const, createdAt: "2026-01-02T13:00:00.000Z", evidence: { providerLocked: true, steps: [{ step: "handoff", state: "inert" }] } }],
  };
}
async function settle() { await Promise.resolve(); await Promise.resolve(); }
function alerts(tree: ReactElement) { return elements(tree).filter((node) => node.props.role === "alert").map((node) => node.props.children); }

beforeEach(() => {
  vi.resetAllMocks();
  state.values = []; state.cursor = 0; state.dependencies = undefined; state.cleanup = undefined;
  state.busy = false; state.pending = Promise.resolve();
  state.history.mockResolvedValue(snapshot());
  state.save.mockResolvedValue({ id: 42, version: 3 });
  state.record.mockResolvedValue({ id: 74 });
});
afterEach(() => { state.cleanup?.(); });

describe("PlaybookHistory", () => {
  it("reads bounded local history on mount without saving or recording automatically", async () => {
    render(); await settle();
    const nodes = elements(render());
    expect(state.history).toHaveBeenCalledExactlyOnceWith({ versionsPage: 1, runsPage: 1 });
    expect(state.save).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
    expect(nodes.some((node) => node.props.children === 'bounded:{"count":50}')).toBe(true);
    expect(nodes.filter((node) => node.type === "details")).toHaveLength(1);
    expect(nodes.find((node) => node.type === "pre")!.props.children).toBe(JSON.stringify(snapshot().runs[0].evidence, null, 2));
    render(); await settle();
    expect(state.history).toHaveBeenCalledTimes(1);
  });

  it("saves only an explicit simulation version and refreshes history after success", async () => {
    render(); await settle();
    expect(button(render(), "save").props.disabled).toBe(true);
    configureName();
    expect(state.save).not.toHaveBeenCalled();
    submit(); await state.pending;
    expect(state.save).toHaveBeenCalledExactlyOnceWith({
      templateId: "ioa", name: "Local IOA review", mode: "simulate",
      filters: { category: "all", source: "all", score: "all", minScore: 7, maxScore: 10 },
    });
    render(); await settle();
    expect(state.history).toHaveBeenCalledTimes(2);
    expect(state.record).not.toHaveBeenCalled();
  });

  it("preserves missing-score configuration without inventing a score", async () => {
    configureName();
    change(select("score"), "missing");
    expect(elements(render()).filter((node) => node.type === "input" && node.props.type === "number")).toHaveLength(0);
    submit(); await state.pending;
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ mode: "simulate", filters: { category: "all", source: "all", score: "missing", minScore: 7, maxScore: 10 } }));
    expect(state.record).not.toHaveBeenCalled();
  });

  it("submits edited range bounds and disables reversed ranges", async () => {
    configureName();
    change(select("template"), "malware-virus");
    change(select("score"), "range");
    const inputs = elements(render()).filter((node) => node.type === "input" && node.props.type === "number");
    expect(inputs.map((node) => [node.props.min, node.props.max])).toEqual([[1, 10], [1, 10]]);
    change(inputs[0], "9"); change(inputs[1], "3");
    expect(button(render(), "save").props.disabled).toBe(true);
    submit(); expect(state.save).not.toHaveBeenCalled();
    change(inputs[0], "4"); change(inputs[1], "8");
    submit(); await state.pending;
    expect(state.save).toHaveBeenCalledExactlyOnceWith({ templateId: "malware-virus", name: "Local IOA review", mode: "simulate", filters: { category: "all", source: "all", score: "range", minScore: 4, maxScore: 8 } });
  });

  it("records the saved version only on click and suppresses duplicate clicks while pending", async () => {
    let resolve!: (value: { id: number }) => void;
    state.record.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(); await settle();
    click(render(), "refresh"); render(); await settle();
    expect(state.record).not.toHaveBeenCalled();
    click(render(), "record");
    const tree = render();
    for (const name of ["record", "save", "refresh"]) expect(button(tree, name).props.disabled).toBe(true);
    click(tree, "record");
    expect(state.record).toHaveBeenCalledExactlyOnceWith(41);
    resolve({ id: 74 }); await state.pending;
    render(); await settle();
    expect(state.history).toHaveBeenCalledTimes(3);
    expect(state.save).not.toHaveBeenCalled();
  });

  it.each(["returned", "thrown"])("shows a safe generic history error for %s failures", async (kind) => {
    if (kind === "returned") state.history.mockResolvedValue({ message: "private database credentials" });
    else state.history.mockRejectedValue(new Error("private database credentials"));
    render(); await settle();
    const tree = render();
    expect(alerts(tree)).toEqual(["error"]);
    expect(elements(tree).some((node) => node.props.children === "unavailable")).toBe(true);
    expect(JSON.stringify(tree)).not.toContain("private database credentials");
  });

  it.each(["save", "record"] as const)("shows safe errors for returned and thrown %s failures", async (operation) => {
    render(); await settle(); configureName();
    const action = operation === "save" ? state.save : state.record;
    for (const outcome of ["returned", "thrown"]) {
      if (outcome === "returned") action.mockResolvedValueOnce({ message: "secret provider payload" });
      else action.mockRejectedValueOnce(new Error("secret provider payload"));
      if (operation === "save") submit(); else click(render(), "record");
      await state.pending;
      const tree = render();
      expect(alerts(tree)).toEqual(["error"]);
      expect(JSON.stringify(tree)).not.toContain("secret provider payload");
    }
    expect(state.history).toHaveBeenCalledTimes(1);
  });

  it("shows empty bounded history without inventing runs", async () => {
    state.history.mockResolvedValue({ limit: 50, versions: [], runs: [] });
    render(); await settle();
    const nodes = elements(render());
    expect(nodes.some((node) => node.props.children === "empty")).toBe(true);
    expect(nodes.filter((node) => node.type === "details")).toHaveLength(0);
    expect(nodes.filter((node) => node.type === "button" && node.props.children === "record")).toHaveLength(0);
  });

  it.each(["success", "failure"])("ignores an in-flight history %s after unmount", async (outcome) => {
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    let reject!: (error: Error) => void;
    state.history.mockReturnValue(new Promise((done, fail) => { resolve = done; reject = fail; }));
    render(); state.cleanup?.();
    if (outcome === "success") resolve(snapshot()); else reject(new Error("stale private error"));
    await settle();
    expect(state.values[0]).toBeNull();
    expect(state.values[1]).toBe(false);
    expect(state.record).not.toHaveBeenCalled();
  });

  it("ignores an older history response after an explicit refresh", async () => {
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    state.history.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render();
    const latest = { ...snapshot(), versions: [], runs: [] };
    state.history.mockResolvedValueOnce(latest);
    click(render(), "refresh"); render(); await settle();
    resolve(snapshot()); await settle();
    expect(state.values[0]).toEqual(latest);
    expect(state.history).toHaveBeenCalledTimes(2);
  });

  it("pages versions and runs independently without reloading the wrong page", async () => {
    const paged = {
      ...snapshot(), versionsPage: 1, versionsPages: 2, versionsTotal: 60,
      runsPage: 1, runsPages: 2, runsTotal: 60,
    };
    state.history.mockResolvedValue(paged);
    render(); await settle();
    expect(state.history).toHaveBeenLastCalledWith({ versionsPage: 1, runsPage: 1 });
    state.history.mockResolvedValue({ ...paged, versionsPage: 2 });
    const nextButtons = elements(render()).filter((node) => node.type === "button" && node.props.children === "next");
    expect(nextButtons).toHaveLength(2);
    (nextButtons[0]!.props.onClick as () => void)();
    render(); await settle();
    expect(state.history).toHaveBeenLastCalledWith({ versionsPage: 2, runsPage: 1 });
    expect(state.save).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
  });

  it("returns to the first version page after saving a new version", async () => {
    const paged = {
      ...snapshot(), versionsPage: 1, versionsPages: 2, versionsTotal: 60,
      runsPage: 1, runsPages: 2, runsTotal: 60,
    };
    state.history.mockResolvedValue(paged);
    render(); await settle();
    state.history.mockResolvedValue({ ...paged, versionsPage: 2 });
    const next = elements(render()).find((node) => node.type === "button" && node.props.children === "next")!;
    (next.props.onClick as () => void)();
    render(); await settle();
    expect(state.history).toHaveBeenLastCalledWith({ versionsPage: 2, runsPage: 1 });
    configureName();
    submit(); await state.pending;
    render(); await settle();
    expect(state.save).toHaveBeenCalledOnce();
    expect(state.history).toHaveBeenLastCalledWith({ versionsPage: 1, runsPage: 1 });
  });
});
