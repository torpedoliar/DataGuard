import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, pending: Promise.resolve(), options: vi.fn(), create: vi.fn(), refresh: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => { state.values[index] = value; }];
  },
  useTransition: () => [false, (run: () => Promise<void>) => { state.pending = run(); }],
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/actions/epdr-incident-handoff", () => ({ getEpdrHandoffOptions: state.options, createEpdrIncidentHandoff: state.create }));
import IncidentHandoff from "./incident-handoff";
function render() { state.cursor = 0; return IncidentHandoff({ detectionId: 10, locale: "id" }); }
function nodes(value: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as ReactElement<Record<string, unknown>>;
  return [element, ...nodes(element.props.children)];
}
function button(name: string) { return nodes(render()).find((item) => item.type === "button" && item.props.children === name)!; }
function click(name: string) { (button(name).props.onClick as () => void)(); }
function change(type: string, index: number, value: string) {
  (nodes(render()).filter((item) => item.type === type)[index].props.onChange as (e: unknown) => void)({ target: { value } });
}
function submit() { (nodes(render()).find((item) => item.type === "form")!.props.onSubmit as (e: unknown) => void)({ preventDefault: vi.fn() }); }
beforeEach(() => {
  vi.resetAllMocks(); state.values = []; state.cursor = 0; state.pending = Promise.resolve();
  state.options.mockResolvedValue({ assignees: [{ id: 7, name: "Operator" }], picGroups: [{ id: 9, name: "Security" }] });
  state.create.mockResolvedValue({ incidentId: 42, existing: false });
});
describe("explicit Incident handoff control", () => {
  it("does not request options or mutate on initial render; opening reads only", async () => {
    render(); expect(state.options).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled();
    click("open"); await state.pending;
    expect(state.options).toHaveBeenCalledOnce(); expect(state.create).not.toHaveBeenCalled();
    expect(button("confirm").props.disabled).toBe(true);
  });
  it("submits separate assignee/PIC IDs and note only on explicit confirmation", async () => {
    click("open"); await state.pending;
    change("select", 0, "7"); change("select", 1, "9"); change("input", 0, "Review required");
    expect(state.create).not.toHaveBeenCalled();
    submit(); await state.pending;
    expect(state.create).toHaveBeenCalledWith({ detectionId: 10, assigneeId: 7, picGroupId: 9, note: "Review required" });
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(nodes(render()).some((item) => item.props.href === "/id/admin/incidents/42")).toBe(true);
  });
  it("keeps missing assignments null and surfaces a safe mutation error", async () => {
    state.create.mockResolvedValue({ message: "private database error" });
    click("open"); await state.pending; change("input", 0, "Review"); submit(); await state.pending;
    expect(state.create).toHaveBeenCalledWith({ detectionId: 10, assigneeId: null, picGroupId: null, note: "Review" });
    expect(nodes(render()).find((item) => item.props.role === "alert")?.props.children).toBe("error");
    expect(state.refresh).not.toHaveBeenCalled();
  });
  it("allows retry after options fail and cancellation never creates an Incident", async () => {
    state.options.mockRejectedValueOnce(new Error("private"));
    click("open"); await state.pending;
    expect(nodes(render()).find((item) => item.props.role === "alert")?.props.children).toBe("error");
    click("retry"); await state.pending; click("cancel");
    expect(button("open")).toBeDefined(); expect(state.create).not.toHaveBeenCalled();
  });
});
