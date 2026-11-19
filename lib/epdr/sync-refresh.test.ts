import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleSyncRefresh } from "./sync-refresh";

afterEach(() => vi.useRealTimers());

describe("local sync snapshot refresh", () => {
  it("refreshes every 15 seconds and stops after five minutes", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const cleanup = scheduleSyncRefresh(refresh);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600_000);
    expect(refresh).toHaveBeenCalledTimes(20);
    expect(vi.getTimerCount()).toBe(0);
    cleanup();
  });

  it("cancels on unmount or when waiting ends", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const cleanup = scheduleSyncRefresh(refresh);
    cleanup();
    vi.advanceTimersByTime(30_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("notifies the caller when the five-minute window ends", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const onStop = vi.fn();
    const cleanup = scheduleSyncRefresh(refresh, onStop);
    vi.advanceTimersByTime(15_000 * 19);
    expect(onStop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000);
    expect(onStop).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(15_000);
    expect(onStop).toHaveBeenCalledOnce();
    cleanup();
  });

  it("does not report a stop when polling is cancelled early", () => {
    vi.useFakeTimers();
    const onStop = vi.fn();
    const cleanup = scheduleSyncRefresh(() => undefined, onStop);
    cleanup();
    vi.advanceTimersByTime(600_000);
    expect(onStop).not.toHaveBeenCalled();
  });
});
