import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { EpdrDetectionRow, EpdrThreatPage } from "@/actions/epdr-threats";
import type { ThreatQuery } from "@/lib/epdr/threat-query";

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  dependencies: undefined as unknown[] | undefined,
  cleanup: undefined as (() => void) | undefined,
  writes: vi.fn(),
  getPage: vi.fn(),
  translate: (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

// Explicit renders preserve hooks and execute the real effect and its cleanup,
// matching endpoint-fleet.test.tsx without a browser or a DOM environment.
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => {
      state.writes(index);
      state.values[index] = typeof value === "function" ? value(state.values[index]) : value;
    }];
  },
  useRef: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = { current: initial };
    return state.values[index];
  },
  useEffect: (run: () => (() => void) | void, dependencies: unknown[]) => {
    if (!state.dependencies || dependencies.some((value, index) => !Object.is(value, state.dependencies?.[index]))) {
      state.cleanup?.();
      state.dependencies = dependencies;
      state.cleanup = run() || undefined;
    }
  },
}));
vi.mock("next-intl", () => ({ useTranslations: () => state.translate }));
vi.mock("@/actions/epdr-threats", () => ({ getEpdrThreatTable: state.getPage }));
vi.mock("./incident-handoff", () => ({ default: () => null }));

import { ThreatTable } from "./threat-panel";

function detection(id: number): EpdrDetectionRow {
  return {
    id, source: "event_export", category: "malware", threatName: null,
    threatScore: 7, severity: "High", detectedAt: new Date("2026-01-01"),
    endpointId: null, hostName: `host-${id}`, incidentId: null,
    incidentStatus: null, ignoredReason: null, historical: false,
  };
}
function page(number = 1, total = 150, id = number): EpdrThreatPage {
  return { rows: [detection(id)], total, page: number, pageSize: 50 };
}
let initial: EpdrThreatPage;
function render() {
  state.cursor = 0;
  return ThreatTable({ initial, ignored: true, locale: "en", isAdmin: false });
}
function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children)];
}
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "object" && "props" in node) return text((node as ReactElement<{ children?: unknown }>).props.children);
  return String(node);
}
function button(tree: ReactElement, label: string) {
  const found = elements(tree).find((node) => node.type === "button" && text(node.props.children) === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
function click(tree: ReactElement, label: string) {
  const target = button(tree, label);
  expect(target.props.disabled).not.toBe(true);
  (target.props.onClick as () => void)();
  return render();
}
function change(tree: ReactElement, label: string, value: string) {
  const target = elements(tree).find((node) => node.props["aria-label"] === label);
  if (!target) throw new Error(`Missing control ${label}`);
  (target.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
  return render();
}
function busy(tree: ReactElement) {
  return elements(tree).find((node) => "aria-busy" in node.props)?.props["aria-busy"];
}
function alerts(tree: ReactElement) {
  return elements(tree).filter((node) => node.props.role === "alert");
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
const defaultQuery: ThreatQuery = {
  page: 1, query: "", category: "all", source: "all", scoreMode: "any",
  minScore: 0, maxScore: 10, sort: "newest", ignored: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  state.values = [];
  state.cursor = 0;
  state.dependencies = undefined;
  state.cleanup = undefined;
  initial = page();
  state.getPage.mockImplementation(async (query: ThreatQuery) => page(query.page));
});
afterEach(() => {
  state.cleanup?.();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("ThreatTable request lifecycle", () => {
  it("marks an invalid score range as not busy and cancels its pending read", async () => {
    let tree = change(render(), "scoreMode", "range");
    tree = change(tree, "minScore", "9");
    tree = change(tree, "maxScore", "2");
    expect(text(alerts(tree))).toBe("invalidRange");
    expect(busy(tree)).toBe(false);
    expect(elements(tree).some((node) => node.props.role === "status")).toBe(false);
    expect(button(tree, "next").props.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.getPage).not.toHaveBeenCalled();
    change(render(), "maxScore", "10");
    await vi.advanceTimersByTimeAsync(300);
    expect(state.getPage).toHaveBeenCalledExactlyOnceWith({ ...defaultQuery, scoreMode: "range", minScore: 9 });
    expect(busy(render())).toBe(false);
  });

  it.each(["action error", "rejection"])("retries a failed page with the exact query after %s", async (outcome) => {
    let tree = change(render(), "query", "needle");
    tree = change(tree, "category", "malware");
    tree = change(tree, "source", "threatsync");
    tree = change(tree, "sort", "scoreHigh");
    await vi.advanceTimersByTimeAsync(300);
    if (outcome === "rejection") state.getPage.mockRejectedValueOnce(new Error("offline"));
    else state.getPage.mockResolvedValueOnce({ message: "unavailable" });
    click(render(), "next");
    await vi.advanceTimersByTimeAsync(300);
    tree = render();
    expect(text(alerts(tree))).toBe("loadError");
    expect(busy(tree)).toBe(false);
    const expected = { ...defaultQuery, page: 2, query: "needle", category: "malware", source: "threatsync", sort: "scoreHigh" };
    expect(state.getPage).toHaveBeenLastCalledWith(expected);
    tree = click(tree, "retry");
    expect(busy(tree)).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(state.getPage).toHaveBeenCalledTimes(3);
    expect(state.getPage).toHaveBeenLastCalledWith(expected);
    tree = render();
    expect(alerts(tree)).toHaveLength(0);
    expect(busy(tree)).toBe(false);
    expect(text(tree)).toContain('pageSummary:{"page":2,"pages":3,"total":150}');
  });

  it("uses a server-clamped page for navigation instead of getting stuck on the requested page", async () => {
    click(render(), "next");
    await vi.advanceTimersByTimeAsync(300);
    state.getPage.mockResolvedValueOnce(page(1, 100, 777));
    click(render(), "next");
    await vi.advanceTimersByTimeAsync(300);
    let tree = render();
    expect(state.getPage).toHaveBeenLastCalledWith({ ...defaultQuery, page: 3 });
    expect(text(tree)).toContain('pageSummary:{"page":1,"pages":2,"total":100}');
    expect(text(tree)).toContain("host-777");
    expect(busy(tree)).toBe(false);
    expect(button(tree, "previous").props.disabled).toBe(true);
    tree = click(tree, "next");
    expect(busy(tree)).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(state.getPage).toHaveBeenLastCalledWith({ ...defaultQuery, page: 2 });
    expect(busy(render())).toBe(false);
  });

  it("adopts refreshed initial props for the default query without another action read", async () => {
    expect(text(render())).toContain("host-1");
    initial = page(1, 1, 888);
    render();
    await vi.advanceTimersByTimeAsync(0);
    const tree = render();
    expect(text(tree)).toContain("host-888");
    expect(text(tree)).not.toContain("host-1");
    expect(busy(tree)).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.getPage).not.toHaveBeenCalled();
  });

  it("refetches the current filtered query when initial props refresh", async () => {
    change(render(), "query", "needle");
    await vi.advanceTimersByTimeAsync(300);
    initial = page(1, 1, 888);
    state.getPage.mockResolvedValueOnce(page(1, 1, 999));
    render();
    await vi.advanceTimersByTimeAsync(300);
    const tree = render();
    expect(state.getPage).toHaveBeenCalledTimes(2);
    expect(state.getPage).toHaveBeenLastCalledWith({ ...defaultQuery, query: "needle" });
    expect(text(tree)).toContain("host-999");
    expect(text(tree)).not.toContain("host-888");
    expect(busy(tree)).toBe(false);
  });

  it.each(["success", "action error", "rejection"])("ignores a stale %s while the latest request is pending", async (outcome) => {
    const old = deferred<EpdrThreatPage | { message: string }>();
    const latest = deferred<EpdrThreatPage>();
    state.getPage.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    change(render(), "query", "old");
    await vi.advanceTimersByTimeAsync(300);
    change(render(), "query", "latest");
    await vi.advanceTimersByTimeAsync(300);
    state.writes.mockClear();
    if (outcome === "rejection") old.reject(new Error("stale"));
    else old.resolve(outcome === "action error" ? { message: "stale" } : page(1, 1, 888));
    await settle();
    expect(state.writes).not.toHaveBeenCalled();
    expect(busy(render())).toBe(true);
    expect(alerts(render())).toHaveLength(0);
    latest.resolve(page(1, 1, 999));
    await settle();
    expect(text(render())).toContain("host-999");
    expect(busy(render())).toBe(false);
  });

  it("does not overwrite the latest completed result with an out-of-order response", async () => {
    const old = deferred<EpdrThreatPage>();
    state.getPage.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page(1, 1, 999));
    change(render(), "query", "old");
    await vi.advanceTimersByTimeAsync(300);
    change(render(), "query", "latest");
    await vi.advanceTimersByTimeAsync(300);
    expect(text(render())).toContain("host-999");
    state.writes.mockClear();
    old.resolve(page(1, 1, 888));
    await settle();
    expect(state.writes).not.toHaveBeenCalled();
    expect(text(render())).toContain("host-999");
    expect(text(render())).not.toContain("host-888");
    expect(busy(render())).toBe(false);
  });
});
