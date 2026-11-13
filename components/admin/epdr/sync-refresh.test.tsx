import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined, refresh: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: (run: () => (() => void) | undefined) => { state.cleanup = run(); },
  useTransition: () => [false, (run: () => void) => run()],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
import SyncRefresh from "./sync-refresh";

afterEach(() => {
  state.cleanup?.();
  state.cleanup = undefined;
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("SyncRefresh", () => {
  it("polls only while waiting and cleans up the timer", () => {
    vi.useFakeTimers();
    SyncRefresh({ waiting: true });
    vi.advanceTimersByTime(15_000);
    expect(state.refresh).toHaveBeenCalledTimes(1);
    state.cleanup?.();
    vi.advanceTimersByTime(15_000);
    expect(state.refresh).toHaveBeenCalledTimes(1);
  });

  it("offers a manual local refresh without polling when not waiting", () => {
    vi.useFakeTimers();
    const tree = SyncRefresh({ waiting: false });
    tree.props.children[0].props.onClick();
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
