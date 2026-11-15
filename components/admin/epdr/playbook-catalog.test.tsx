import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, preview: vi.fn(), pending: Promise.resolve() }));
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
vi.mock("@/actions/epdr-playbooks", () => ({ previewEpdrPlaybooks: state.preview }));
import PlaybookCatalog from "./playbook-catalog";
function render() { state.cursor = 0; return PlaybookCatalog(); }
function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children)];
}
beforeEach(() => { state.values = []; state.cursor = 0; vi.clearAllMocks(); });
describe("playbook catalog interaction", () => {
  it("shows all 12 templates without fetching until explicit preview", () => {
    const nodes = elements(render());
    expect(nodes.filter((n) => n.type === "article")).toHaveLength(12);
    expect(nodes.filter((n) => n.type === "select")).toHaveLength(3);
    expect(state.preview).not.toHaveBeenCalled();
  });
  it("filters categories and health sources interactively", () => {
    const selects = elements(render()).filter((n) => n.type === "select");
    (selects[0].props.onChange as (e: unknown) => void)({ target: { value: "virus" } });
    expect(elements(render()).filter((n) => n.type === "article")).toHaveLength(1);
    (selects[0].props.onChange as (e: unknown) => void)({ target: { value: "all" } });
    (selects[1].props.onChange as (e: unknown) => void)({ target: { value: "health" } });
    expect(elements(render()).filter((n) => n.type === "article")).toHaveLength(5);
    expect(state.preview).not.toHaveBeenCalled();
  });
  it("offers min/max bounds and rejects reversed ranges visibly", () => {
    const score = elements(render()).filter((n) => n.type === "select")[2];
    (score.props.onChange as (e: unknown) => void)({ target: { value: "range" } });
    const selects = elements(render()).filter((n) => n.type === "select");
    expect(selects).toHaveLength(5);
    (selects[3].props.onChange as (e: unknown) => void)({ target: { value: "9" } });
    (selects[4].props.onChange as (e: unknown) => void)({ target: { value: "3" } });
    expect(elements(render()).some((n) => n.props.role === "alert")).toBe(true);
    expect(state.preview).not.toHaveBeenCalled();
  });
  it("loads a stored preview only on demand and shows errors without retaining old data", async () => {
    state.preview.mockResolvedValueOnce({ siteId: 42, siteName: "Site A", rows: [], limit: 100, truncated: true, detectionCompleteness: "unavailable" });
    const button = elements(render()).find((n) => typeof n.props.onClick === "function");
    (button!.props.onClick as () => void)(); await state.pending;
    expect(state.preview).toHaveBeenCalledOnce();
    expect(state.values[3]).toMatchObject({ siteId: 42 });
    expect(elements(render()).some((n) => n.props.children === "completenessUnavailable")).toBe(true);
    state.preview.mockRejectedValueOnce(new Error("unavailable"));
    (button!.props.onClick as () => void)(); await state.pending;
    expect(state.values[3]).toBeNull();
    expect(elements(render()).some((n) => n.props.role === "alert")).toBe(true);
  });
});
