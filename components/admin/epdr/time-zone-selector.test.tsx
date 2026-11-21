import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const mocks = vi.hoisted(() => ({ save: vi.fn(), setZone: vi.fn(), refresh: vi.fn(), pending: Promise.resolve() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: () => [null, vi.fn()],
  useTransition: () => [false, (run: () => Promise<void>) => { mocks.pending = run(); }],
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/actions/epdr-time-zone", () => ({ setEpdrTimeZone: mocks.save }));
vi.mock("./time-zone-provider", () => ({ useEpdrTimeZone: () => ({ personalTimeZone: null, setPersonalTimeZone: mocks.setZone }) }));
import { TimeZoneSelector } from "./time-zone-selector";
function change(zone: string | null) {
  const tree = TimeZoneSelector();
  const picker = tree.props.children[0] as ReactElement<{ onChange: (zone: string | null) => void }>;
  picker.props.onChange(zone);
  return mocks.pending;
}
beforeEach(() => { vi.clearAllMocks(); });
describe("personal timezone selector", () => {
  it.each([null, "Asia/Jakarta"])("refreshes server aggregates after successful preference change %s", async (zone) => {
    mocks.save.mockResolvedValue({ timeZone: zone });
    await change(zone);
    expect(mocks.save).toHaveBeenCalledWith(zone);
    expect(mocks.setZone).toHaveBeenCalledWith(zone);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("does not refresh or update display when saving fails", async () => {
    mocks.save.mockResolvedValue({ message: "Unavailable" });
    await change("UTC");
    expect(mocks.setZone).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
