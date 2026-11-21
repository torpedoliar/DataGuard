import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effect: false, load: vi.fn(), save: vi.fn(), pending: Promise.resolve() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => { state.values[index] = value; }];
  },
  useEffect: (run: () => void) => { if (!state.effect) { state.effect = true; run(); } },
  useTransition: () => [false, (run: () => Promise<void>) => { state.pending = run(); }],
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/actions/epdr-notifications", () => ({ getEpdrNotificationPolicy: state.load, setEpdrNotificationPolicy: state.save }));
vi.mock("./time-zone-provider", () => ({ useEpdrTimeZone: () => ({ timeZone: "UTC" }) }));
import NotificationSettings from "./notification-settings";
import { TimeZoneSelect } from "./time-zone-selector";
function render() { state.cursor = 0; return NotificationSettings(); }
function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children)];
}
const policy = { enabled: true, notifyHeld: false, escalateOverdueToAdmins: false, digestEnabled: true,
  digestHourUtc: 8, quietStart: 22, quietEnd: 7, timeZone: "Asia/Jakarta", updatedAt: null };
beforeEach(() => {
  vi.clearAllMocks(); state.values = []; state.cursor = 0; state.effect = false;
  state.load.mockResolvedValue(policy); state.save.mockResolvedValue(policy);
});
describe("notification scheduling timezone", () => {
  it("loads scheduling timezone separately from personal UTC display", async () => {
    render(); await Promise.resolve();
    const picker = elements(render()).find((node) => node.type === TimeZoneSelect)!;
    expect(picker.props.value).toBe("Asia/Jakarta");
    expect(state.save).not.toHaveBeenCalled();
  });
  it("saves changed zone without shifting existing wall-clock hours", async () => {
    render(); await Promise.resolve();
    const picker = elements(render()).find((node) => node.type === TimeZoneSelect)!;
    (picker.props.onChange as (zone: string) => void)("Asia/Jayapura");
    const button = elements(render()).find((node) => node.type === "button")!;
    (button.props.onClick as () => void)(); await state.pending;
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ timeZone: "Asia/Jayapura", digestHourUtc: 8, quietStart: 22, quietEnd: 7 }));
  });
});
