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
});
