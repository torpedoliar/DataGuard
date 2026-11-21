import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { EpdrEndpointPage, EpdrEndpointRow } from "@/actions/epdr-endpoints";
import { summarizeFleet } from "@/lib/epdr/posture";
import { formatEpdrDateTime } from "@/lib/epdr/time-zone";

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  dependencies: undefined as unknown[] | undefined,
  cleanup: undefined as (() => void) | undefined,
  writes: vi.fn(),
  getPage: vi.fn(),
  drawer: vi.fn(),
  translate: (key: string, values?: Record<string, number>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

// Match the nearby node-environment React tests: retain state across explicit
// renders and run the component's real effect/cleanup on dependency changes.
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
  useMemo: (calculate: () => unknown) => calculate(),
  useEffect: (run: () => () => void, dependencies: unknown[]) => {
    if (!state.dependencies || dependencies.some((value, index) => !Object.is(value, state.dependencies?.[index]))) {
      state.cleanup?.();
      state.dependencies = dependencies;
      state.cleanup = run();
    }
  },
}));
vi.mock("./time-zone-provider", () => ({ useEpdrTimeZone: () => ({ timeZone: "Asia/Jayapura" }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en", useTranslations: () => state.translate }));
vi.mock("@/actions/epdr-endpoints", () => ({ getEpdrEndpointPage: state.getPage }));
vi.mock("./endpoint-drawer", () => ({ default: (props: { endpoint: EpdrEndpointRow | null }) => { state.drawer(props); return null; } }));
vi.mock("@/components/ui/status-badge", () => ({ default: ({ children }: { children: unknown }) => <span>{children as string}</span> }));

import EndpointFleet from "./endpoint-fleet";

function endpoint(id: number): EpdrEndpointRow {
  return {
    id, hostName: `endpoint-${id}`, ipAddress: null, deviceType: 1,
    operatingSystem: "Windows", groupPath: "Headquarters", agentVersion: null,
    bucket: "protected", accumulatedProtectionStatus: null, offline: false,
    lastConnectionAt: null, lastSyncedAt: new Date("2026-01-01"),
    rebootRequested: null, deviceId: null, assetName: null, isCritical: false, noAuto: false,
  };
}
const endpoints = [endpoint(900)];
const posture = summarizeFleet(endpoints);
function page(number = 1, total = 101): EpdrEndpointPage {
  const start = (number - 1) * 50;
  return {
    rows: Array.from({ length: Math.min(50, Math.max(0, total - start)) }, (_, index) => endpoint(start + index + 1)),
    total, page: number, pageSize: 50,
  };
}
function render(overrides: Partial<Parameters<typeof EndpointFleet>[0]> = {}) {
  state.cursor = 0;
  return EndpointFleet({ endpoints, posture, isAdmin: false, locale: "en", ...overrides });
}
function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  if (typeof element.type === "function") {
    return elements((element.type as (props: Record<string, unknown>) => ReactNode)(element.props));
  }
  return [element, ...elements(element.props.children)];
}
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "object" && "props" in node) return text((node as ReactElement<{ children?: unknown }>).props.children);
  return String(node);
}
function button(tree: ReactElement, label: string) {
  const found = elements(tree).find((node) => node.type === "button" && text(node.props.children).startsWith(label));
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
function click(tree: ReactElement, label: string) {
  const target = button(tree, label);
  if (!target.props.disabled) (target.props.onClick as () => void)();
  return render();
}
function change(tree: ReactElement, field: "search" | "group" | "os" | "sort" | "deviceType", value: string) {
  const target = field === "search"
    ? elements(tree).find((node) => node.type === "input" && node.props.type === "search")
    : elements(tree).find((node) => node.type === "label" && text(node.props.children).startsWith(field));
  const control = field === "search" ? target : elements(target).find((node) => node.type === "select");
  if (!control) throw new Error(`Missing control ${field}`);
  (control.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
  return render();
}
function rows(tree: ReactElement) {
  return elements(tree).filter((node) => node.type === "tbody").flatMap((node) => elements(node.props.children).filter((child) => child.type === "tr"));
}
function loading(tree: ReactElement) {
  return elements(tree).some((node) => node.props.role === "status" && text(node.props.children) === "loading");
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
}
async function load(overrides: Partial<Parameters<typeof EndpointFleet>[0]> = {}) {
  render(overrides);
  await vi.advanceTimersByTimeAsync(250);
  return render(overrides);
}
async function secondPage() {
  const tree = await load();
  click(tree, "next");
  await vi.advanceTimersByTimeAsync(250);
  return render();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  state.values = [];
  state.cursor = 0;
  state.dependencies = undefined;
  state.cleanup = undefined;
  state.getPage.mockImplementation(async ({ page: number }: { page: number }) => page(number));
});
afterEach(() => {
  state.cleanup?.();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("EndpointFleet server-side list", () => {
  it("keeps relative last-seen labels with selected-zone tooltips and null placeholders", async () => {
    const seenAt = new Date("2026-01-01T00:00:00Z");
    const seen = { ...endpoint(1), lastConnectionAt: seenAt };
    state.getPage.mockResolvedValue({ ...page(), rows: [seen, endpoint(2)] });
    const tree = await load({ endpoints: [seen] });
    const expected = formatEpdrDateTime(seenAt, "Asia/Jayapura", "en");
    expect(elements(tree).filter((node) => node.props.title === expected)).toHaveLength(1);
    const cells = elements(tree).filter((node) => node.type === "td");
    expect(cells.some((node) => node.props.children === "—" && node.props.title === undefined)).toBe(true);
    expect(text(tree)).not.toContain(expected);
  });
  it("loads action rows in pages of 50 and navigates using the server total, not the initial snapshot", async () => {
    expect(loading(render())).toBe(true);
    expect(state.getPage).not.toHaveBeenCalled();
    let tree = await load();
    expect(state.getPage).toHaveBeenCalledExactlyOnceWith({ page: 1, query: "", filter: "all", group: "", os: "", deviceType: "", sort: "name" });
    expect(rows(tree)).toHaveLength(50);
    expect(text(rows(tree))).toContain("endpoint-1");
    expect(text(rows(tree))).not.toContain("endpoint-900");
    expect(text(tree)).toContain('page:{"page":1,"pages":3,"total":101}');
    expect(button(tree, "previous").props.disabled).toBe(true);
    expect(button(tree, "next").props.disabled).toBe(false);

    tree = click(tree, "next");
    expect(loading(tree)).toBe(true);
    expect(rows(tree)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(250);
    tree = render();
    expect(state.getPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(rows(tree)).toHaveLength(50);
    expect(text(rows(tree))).toContain("endpoint-51");
    click(tree, "next");
    await vi.advanceTimersByTimeAsync(250);
    tree = render();
    expect(rows(tree)).toHaveLength(1);
    expect(text(tree)).toContain('page:{"page":3,"pages":3,"total":101}');
    expect(button(tree, "next").props.disabled).toBe(true);
    click(tree, "next");
    expect(loading(render())).toBe(false);
    click(render(), "previous");
    await vi.advanceTimersByTimeAsync(250);
    expect(state.getPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
  });

  it.each(["attention", "offline", "outdated", "unknown_contact", "unlinked", "all"])("resets %s filtering to page one", async (filter) => {
    const tree = await secondPage();
    click(tree, `filters.${filter}`);
    expect(loading(render())).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(state.getPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, filter }));
    expect(loading(render())).toBe(false);
  });

  it.each([
    ["group", "Headquarters"], ["os", "Windows"], ["deviceType", "3"], ["deviceType", ""],
    ["sort", "contact"], ["sort", "protection"], ["search", "needle"],
  ] as const)("resets page on %s changes and forwards the value", async (field, value) => {
    change(await secondPage(), field, value);
    await vi.advanceTimersByTimeAsync(250);
    expect(state.getPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, [field === "search" ? "query" : field]: value }));
    expect(loading(render())).toBe(false);
  });

  it("debounces search for 250ms after the last edit and retains other query controls", async () => {
    let tree = await load();
    tree = change(tree, "group", "Headquarters");
    tree = change(tree, "os", "Windows");
    tree = change(tree, "deviceType", "3");
    tree = change(tree, "sort", "contact");
    tree = click(tree, "filters.offline");
    tree = change(tree, "search", "a");
    await vi.advanceTimersByTimeAsync(200);
    tree = change(tree, "search", "ab");
    await vi.advanceTimersByTimeAsync(249);
    expect(state.getPage).toHaveBeenCalledTimes(1);
    expect(loading(tree)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.getPage).toHaveBeenCalledTimes(2);
    expect(state.getPage).toHaveBeenLastCalledWith({ page: 1, query: "ab", filter: "offline", group: "Headquarters", os: "Windows", deviceType: "3", sort: "contact" });
    expect(loading(render())).toBe(false);
    click(render(), "next");
    await vi.advanceTimersByTimeAsync(250);
    expect(state.getPage).toHaveBeenLastCalledWith({ page: 2, query: "ab", filter: "offline", group: "Headquarters", os: "Windows", deviceType: "3", sort: "contact" });
    change(render(), "deviceType", "");
    await vi.advanceTimersByTimeAsync(250);
    expect(state.getPage).toHaveBeenLastCalledWith({ page: 1, query: "ab", filter: "offline", group: "Headquarters", os: "Windows", deviceType: "", sort: "contact" });
  });

  it.each(["success", "action error", "rejection"])("ignores a stale %s while the newer request is pending", async (outcome) => {
    const old = deferred<EpdrEndpointPage | { message: string }>();
    const latest = deferred<EpdrEndpointPage>();
    state.getPage.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    await load();
    change(render(), "search", "latest");
    await vi.advanceTimersByTimeAsync(250);
    state.writes.mockClear();
    if (outcome === "rejection") old.reject(new Error("stale"));
    else old.resolve(outcome === "action error" ? { message: "stale" } : page());
    await settle();
    expect(state.writes).not.toHaveBeenCalled();
    expect(loading(render())).toBe(true);
    latest.resolve({ ...page(1, 1), rows: [endpoint(777)] });
    await settle();
    expect(text(rows(render()))).toContain("endpoint-777");
    expect(loading(render())).toBe(false);
  });

  it("does not overwrite a newer completed response with an older out-of-order response", async () => {
    const old = deferred<EpdrEndpointPage>();
    state.getPage.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...page(1, 1), rows: [endpoint(777)] });
    await load();
    change(render(), "search", "latest");
    await vi.advanceTimersByTimeAsync(250);
    expect(text(rows(render()))).toContain("endpoint-777");
    state.writes.mockClear();
    old.resolve(page());
    await settle();
    expect(state.writes).not.toHaveBeenCalled();
    expect(text(rows(render()))).toContain("endpoint-777");
  });

  it("cancels an unsent debounce on unmount", async () => {
    render();
    state.cleanup?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.getPage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["success", "action error", "rejection"])("suppresses all state writes for an in-flight %s after unmount", async (outcome) => {
    const pending = deferred<EpdrEndpointPage | { message: string }>();
    state.getPage.mockReturnValueOnce(pending.promise);
    await load();
    state.cleanup?.();
    state.writes.mockClear();
    if (outcome === "rejection") pending.reject(new Error("unmounted"));
    else pending.resolve(outcome === "action error" ? { message: "unmounted" } : page());
    await settle();
    expect(state.writes).not.toHaveBeenCalled();
    expect(state.getPage).toHaveBeenCalledTimes(1);
  });

  it.each(["action error", "rejection"])("shows %s without old rows and retries the same page/query", async (outcome) => {
    let tree = await secondPage();
    if (outcome === "rejection") state.getPage.mockRejectedValueOnce(new Error("offline"));
    else state.getPage.mockResolvedValueOnce({ message: "unavailable" });
    tree = click(tree, "next");
    await vi.advanceTimersByTimeAsync(250);
    tree = render();
    expect(elements(tree).some((node) => node.props.role === "alert" && text(node.props.children).includes("error"))).toBe(true);
    expect(rows(tree)).toHaveLength(0);
    expect(loading(tree)).toBe(false);
    expect(elements(tree).some((node) => node.type === "button" && node.props.children === "next")).toBe(false);
    const failedQuery = state.getPage.mock.calls.at(-1)?.[0];
    click(tree, "retry");
    expect(loading(render())).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    tree = render();
    expect(state.getPage).toHaveBeenLastCalledWith(failedQuery);
    expect(rows(tree)).toHaveLength(1);
    expect(elements(tree).some((node) => node.props.role === "alert")).toBe(false);
    expect(loading(tree)).toBe(false);
  });

  it("renders an empty successful result with its server count instead of an error", async () => {
    state.getPage.mockResolvedValueOnce(page(1, 0));
    const tree = await load();
    expect(text(tree)).toContain("endpoints.noResults");
    expect(text(tree)).toContain('page:{"page":1,"pages":1,"total":0}');
    expect(button(tree, "previous").props.disabled).toBe(true);
    expect(button(tree, "next").props.disabled).toBe(true);
    expect(elements(tree).some((node) => node.props.role === "alert")).toBe(false);
  });

  it("does not enter loading or schedule another read when already-selected all is clicked", async () => {
    let tree = await load();
    tree = click(tree, "filters.all");
    expect(loading(tree)).toBe(false);
    expect(rows(tree)).toHaveLength(50);
    expect(state.getPage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(loading(render())).toBe(false);
    expect(rows(render())).toHaveLength(50);
    expect(state.getPage).toHaveBeenCalledTimes(1);
  });

  it("reports the canonical protected count without treating no-license devices as attention", async () => {
    state.getPage.mockResolvedValueOnce(page(1, 0));
    const counts = { ...posture.counts, protected: 3, outdated: 1, disabled: 0, error: 0, install_error: 0, no_license: 2, unknown: 1 };
    const remote = { ...endpoint(903), hostName: "outside-map", bucket: "unknown" as const };
    const mixedPosture = { ...posture, total: 7, counts, protectedPct: 57.1, attention: [remote] };
    const tree = await load({ posture: mixedPosture });
    expect(text(tree)).toContain('endpoints.protectedOf:{"protected":4,"total":7}');
    expect(text(tree)).not.toContain('endpoints.needsAttention:{"count":3}');
    expect(text(button(tree, "endpoints.needsAttention"))).toContain('endpoints.needsAttention:{"count":1}');
    expect(button(tree, "outside-map")).toBeDefined();
  });

  it("opens attention endpoints outside the bounded map sample once their latest row is available", async () => {
    const remote = { ...endpoint(902), hostName: "remote-priority", bucket: "disabled" as const };
    state.getPage.mockResolvedValueOnce({ ...page(1, 1), rows: [remote] });
    const overrides = { posture: { ...posture, attention: [remote], counts: { ...posture.counts, disabled: 1 } } };
    const tree = await load(overrides);
    click(tree, "remote-priority");
    const opened = render(overrides);
    elements(opened);
    expect(state.drawer).toHaveBeenLastCalledWith(expect.objectContaining({ endpoint: expect.objectContaining({ id: 902, bucket: "disabled" }) }));
  });
  it("opens a dashboard deep link with the bucket already applied", async () => {
    state.getPage.mockImplementation(async ({ page: number }: { page: number }) => page(number));
    const tree = await load({ initialFilter: "no_license" });
    expect(state.getPage).toHaveBeenCalledWith(expect.objectContaining({ filter: "no_license", page: 1 }));
    // The bucket has a visible pressed chip that clears back to all.
    const pressed = elements(tree).filter((node) => node.type === "button" && node.props["aria-pressed"] === true);
    expect(pressed.map((node) => text(node.props.children))).toEqual(expect.arrayContaining([expect.stringContaining("filters.no_license")]));
    (pressed.find((node) => text(node.props.children).includes("filters.no_license"))!.props.onClick as () => void)();
    render({ initialFilter: "no_license" });
    await vi.advanceTimersByTimeAsync(250);
    expect(state.getPage).toHaveBeenLastCalledWith(expect.objectContaining({ filter: "all", page: 1 }));
  });

  it("opens a contextual search from another page", async () => {
    state.getPage.mockImplementation(async ({ page: number }: { page: number }) => page(number));
    await load({ initialQuery: "host-7" });
    expect(state.getPage).toHaveBeenCalledWith(expect.objectContaining({ query: "host-7", page: 1 }));
  });
});
