import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatEpdrDateTime } from "@/lib/epdr/time-zone";
import type { ReactElement } from "react";
import type { ReadSyncStatus } from "@/lib/epdr/read-sync-queue";

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  dependencies: undefined as unknown[] | undefined,
  cleanup: undefined as (() => void) | undefined,
  busy: false,
  pending: Promise.resolve(),
  getStatus: vi.fn(),
  request: vi.fn(),
  cancel: vi.fn(),
  router: { refresh: vi.fn() },
  observed: { current: null as unknown },
  translate: (key: string, values?: Record<string, string>) => values ? `${key}:${values.time}` : key,
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
  useRef: () => state.observed,
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
vi.mock("./time-zone-provider", () => ({ useEpdrTimeZone: () => ({ timeZone: "Asia/Jayapura" }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en", useTranslations: () => state.translate }));
vi.mock("next/navigation", () => ({ useRouter: () => state.router }));
vi.mock("@/actions/epdr-read-sync", () => ({
  getEpdrReadSyncStatus: state.getStatus,
  requestEpdrReadSync: state.request,
  cancelEpdrReadSync: state.cancel,
}));
// Spy on scheduling while retaining the real bounded, local-only timer contract.
vi.mock("@/lib/epdr/sync-refresh", async (original) => {
  const actual = await original<typeof import("@/lib/epdr/sync-refresh")>();
  return { scheduleSyncRefresh: vi.fn(actual.scheduleSyncRefresh) };
});

import { scheduleSyncRefresh } from "@/lib/epdr/sync-refresh";
import ReadSyncPanel from "./read-sync-panel";

function render(enabled = true) {
  state.cursor = 0;
  return ReadSyncPanel({ enabled });
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
function button(tree: ReactElement, name: "request" | "refresh" | "cancel") {
  return elements(tree).find((node) => node.type === "button" && text(node.props.children) === name)!;
}
function click(tree: ReactElement, name: "request" | "refresh" | "cancel") {
  const target = button(tree, name);
  if (!target.props.disabled) (target.props.onClick as () => void)();
}
function messages(tree: ReactElement) {
  return elements(tree).filter((node) => node.type === "p").map((node) => node.props.children);
}
function snapshot(status: ReadSyncStatus["status"] = "idle"): ReadSyncStatus {
  return {
    status, requestId: null, requestedAt: null, startedAt: null, finishedAt: null, retryAt: null, error: null,
    leaseExpiresAt: null, workerLastSeenAt: null,
  };
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  state.observed.current = null;
  state.values = [];
  state.cursor = 0;
  state.dependencies = undefined;
  state.cleanup = undefined;
  state.busy = false;
  state.pending = Promise.resolve();
  state.getStatus.mockResolvedValue(snapshot());
});
afterEach(() => {
  state.cleanup?.();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("ReadSyncPanel", () => {
  it("reads local status on mount without requesting a provider sync", async () => {
    render();
    await settle();
    expect(state.getStatus).toHaveBeenCalledExactlyOnceWith();
    expect(scheduleSyncRefresh).toHaveBeenCalledOnce();
    expect(state.request).not.toHaveBeenCalled();
    expect(messages(render())).toContain("states.idle");
    expect(state.getStatus).toHaveBeenCalledTimes(1);
  });

  it.each(["queued", "already_pending"] as const)("submits a real request and reports %s, not success", async (status) => {
    state.request.mockResolvedValue({ status, requestId: 42 });
    render();
    await settle();
    click(render(), "request");
    expect(state.request).toHaveBeenCalledExactlyOnceWith();
    await state.pending;
    state.getStatus.mockResolvedValue(snapshot("queued"));
    render();
    await settle();
    const tree = render();
    expect(messages(tree)).toEqual(expect.arrayContaining([status, "states.queued", "waiting"]));
    expect(messages(tree)).not.toContain("states.succeeded");
    expect(button(tree, "request").props.disabled).toBe(true);
  });

  it("reports cooldown with its retry time without claiming the request was queued", async () => {
    const retryAt = "2026-01-02T12:30:00.000Z";
    state.request.mockResolvedValue({ status: "cooldown", retryAt });
    click(render(), "request");
    await state.pending;
    const text = messages(render());
    expect(text).toContain(`cooldown:${formatEpdrDateTime(retryAt, "Asia/Jayapura", "en")}`);
    expect(text).not.toContain("queued");
    expect(text).not.toContain("states.succeeded");
  });

  it.each(["connection_unavailable", "forbidden", "internal_error"])("reports unavailable for %s", async (reason) => {
    state.request.mockResolvedValue({ status: "unavailable", reason });
    click(render(), "request");
    await state.pending;
    expect(messages(render())).toContain("unavailable");
    expect(messages(render())).not.toContain("queued");
    expect(messages(render())).not.toContain("states.succeeded");
  });

  it("replaces earlier queued feedback when the next request throws", async () => {
    state.request.mockResolvedValueOnce({ status: "queued", requestId: 42 });
    click(render(), "request");
    await state.pending;
    expect(messages(render())).toContain("queued");
    state.request.mockRejectedValueOnce(new Error("offline"));
    click(render(), "request");
    expect(messages(render())).not.toContain("queued");
    await state.pending;
    expect(messages(render())).toContain("unavailable");
    expect(messages(render())).not.toContain("states.succeeded");
  });

  it("disables requests for disabled configuration but leaves local refresh available", async () => {
    const tree = render(false);
    expect(button(tree, "request").props.disabled).toBe(true);
    click(tree, "request");
    click(tree, "refresh");
    expect(state.request).not.toHaveBeenCalled();
    expect(state.router.refresh).toHaveBeenCalledOnce();
    render(false);
    await settle();
    expect(state.getStatus).toHaveBeenCalledTimes(2);
    expect(scheduleSyncRefresh).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(["queued", "running"] as const)("disables requests while stored status is %s", async (status) => {
    state.getStatus.mockResolvedValue(snapshot(status));
    render();
    await settle();
    const tree = render();
    expect(button(tree, "request").props.disabled).toBe(true);
    click(tree, "request");
    expect(state.request).not.toHaveBeenCalled();
  });

  it("disables duplicate requests while a transition is pending", async () => {
    let resolve!: (value: { status: "queued"; requestId: number }) => void;
    state.request.mockReturnValue(new Promise((done) => { resolve = done; }));
    click(render(), "request");
    const pendingTree = render();
    expect(button(pendingTree, "request").props.disabled).toBe(true);
    click(pendingTree, "request");
    expect(state.request).toHaveBeenCalledOnce();
    resolve({ status: "queued", requestId: 42 });
    await state.pending;
    expect(button(render(), "request").props.disabled).toBe(false);
  });

  it("bounds scheduled status reads to 20 ticks without enqueueing or refreshing the router", async () => {
    render();
    await vi.advanceTimersByTimeAsync(15_000 * 25);
    expect(state.getStatus).toHaveBeenCalledTimes(21);
    expect(vi.getTimerCount()).toBe(0);
    expect(state.request).not.toHaveBeenCalled();
    expect(state.router.refresh).not.toHaveBeenCalled();
  });

  it.each(["succeeded", "partial", "failed", "cancelled"] as const)("refreshes once when polling transitions to %s, but not on initial terminal load", async (status) => {
    state.getStatus.mockResolvedValue({ ...snapshot(), status, requestId: 42 });
    render();
    await settle();
    expect(state.router.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(state.router.refresh).not.toHaveBeenCalled();

    state.getStatus.mockResolvedValue({ ...snapshot("running"), requestId: 43 });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(state.router.refresh).not.toHaveBeenCalled();
    state.getStatus.mockResolvedValue({ ...snapshot(), status, requestId: 43 });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(state.router.refresh).toHaveBeenCalledTimes(1);
    const text = messages(render());
    expect(text).toContain(`states.${status}`);
    if (status !== "succeeded") expect(text).not.toContain("states.succeeded");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.router.refresh).toHaveBeenCalledTimes(1);
    expect(state.request).not.toHaveBeenCalled();
  });

  it("refreshes for a different request with the same terminal status", async () => {
    state.getStatus.mockResolvedValue({ ...snapshot("succeeded"), requestId: 42 });
    render();
    await settle();
    state.getStatus.mockResolvedValue({ ...snapshot("succeeded"), requestId: 43 });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(state.router.refresh).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(state.router.refresh).toHaveBeenCalledOnce();
  });

  it("cleans up polling and ignores an in-flight status response after unmount", async () => {
    let resolve!: (value: ReadSyncStatus) => void;
    state.getStatus.mockReturnValue(new Promise((done) => { resolve = done; }));
    render();
    state.cleanup?.();
    expect(vi.getTimerCount()).toBe(0);
    resolve(snapshot("succeeded"));
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.values[0]).toBeNull();
    expect(state.getStatus).toHaveBeenCalledOnce();
  });

  it("ignores an in-flight status error after unmount", async () => {
    let reject!: (error: Error) => void;
    state.getStatus.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    render();
    state.cleanup?.();
    reject(new Error("offline"));
    await settle();
    expect(state.values[1]).toBeNull();
  });

  it("shows unavailable on status read failure without fabricating success", async () => {
    state.getStatus.mockRejectedValue(new Error("offline"));
    render();
    await settle();
    expect(messages(render())).toEqual(expect.arrayContaining(["states.idle", "unavailable"]));
    expect(messages(render())).not.toContain("states.succeeded");
  });

  it("renders a partial failed snapshot and finish time without treating completion as success", async () => {
    const finishedAt = "2026-01-02T12:30:00.000Z";
    state.getStatus.mockResolvedValue({ status: "failed", finishedAt });
    render();
    await settle();
    const text = messages(render());
    expect(text).toContain("states.failed");
    expect(text).toContain(`finished:${formatEpdrDateTime(finishedAt, "Asia/Jayapura", "en")}`);
    expect(text).not.toContain("states.succeeded");
    expect(text).not.toContain("waiting");
  });

  it("falls back to idle for a partial snapshot with no status", async () => {
    state.getStatus.mockResolvedValue({});
    render();
    await settle();
    expect(messages(render())).toContain("states.idle");
    expect(messages(render())).not.toContain("states.succeeded");
    expect(state.request).not.toHaveBeenCalled();
  });

  it("shows start time and an active lease while a request is running", async () => {
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const leaseExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    state.getStatus.mockResolvedValue({ ...snapshot("running"), requestId: 42, startedAt, leaseExpiresAt });
    render();
    await settle();
    const text = messages(render());
    expect(text).toContain(`started:${formatEpdrDateTime(startedAt, "Asia/Jayapura", "en")}`);
    expect(text).toContain(`leaseActive:${formatEpdrDateTime(leaseExpiresAt, "Asia/Jayapura", "en")}`);
  });

  it("warns while a request runs with an expired lease", async () => {
    const leaseExpiresAt = new Date(Date.now() - 60_000).toISOString();
    state.getStatus.mockResolvedValue({ ...snapshot("running"), requestId: 42, leaseExpiresAt });
    render();
    await settle();
    expect(messages(render())).toContain("leaseExpired");
  });

  it("shows the last worker heartbeat while a request is queued", async () => {
    const workerLastSeenAt = new Date(Date.now() - 30_000).toISOString();
    state.getStatus.mockResolvedValue({ ...snapshot("queued"), requestId: 42, workerLastSeenAt });
    render();
    await settle();
    expect(messages(render())).toContain(`workerLastSeen:${formatEpdrDateTime(workerLastSeenAt, "Asia/Jayapura", "en")}`);
  });

  it("warns that no worker heartbeat exists for a queued request", async () => {
    state.getStatus.mockResolvedValue({ ...snapshot("queued"), requestId: 42 });
    render();
    await settle();
    expect(messages(render())).toContain("workerMissing");
  });

  it("explains that polling paused instead of leaving an active request silent", async () => {
    state.getStatus.mockResolvedValue({ ...snapshot("running"), requestId: 42 });
    render();
    await settle();
    expect(messages(render())).not.toContain("pollingStopped");
    await vi.advanceTimersByTimeAsync(15_000 * 20);
    expect(messages(render())).toContain("pollingStopped");
  });

  it("explains a worker-timeout failure and re-enables the request button", async () => {
    state.getStatus.mockResolvedValue({ ...snapshot("failed"), requestId: 42, error: "worker_timeout" });
    render();
    await settle();
    const tree = render();
    expect(messages(tree)).toContain("errors.worker_timeout");
    expect(button(tree, "request").props.disabled).toBe(false);
  });

  it("cancels an active request through the server action", async () => {
    state.getStatus.mockResolvedValue({ ...snapshot("running"), requestId: 42 });
    state.cancel.mockResolvedValue({ status: "cancelled" });
    render();
    await settle();
    click(render(), "cancel");
    await settle();
    await settle();
    await settle();
    expect(state.cancel).toHaveBeenCalledOnce();
    expect(messages(render())).toContain("cancelDone");
  });
});
