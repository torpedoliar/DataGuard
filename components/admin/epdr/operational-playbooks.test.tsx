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
vi.mock("@/actions/epdr-operational-playbooks", () => ({ previewEpdrOperationalPlaybooks: state.preview }));
import OperationalPlaybooks from "./operational-playbooks";
function render() { state.cursor = 0; return OperationalPlaybooks(); }
function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children)];
}
async function load() {
  const button = elements(render()).find((element) => element.type === "button")!;
  (button.props.onClick as () => void)(); await state.pending;
}
beforeEach(() => { state.values = []; state.cursor = 0; vi.clearAllMocks(); });
describe("operational preview component", () => {
  it("loads only after an explicit click and labels observation-only behavior", async () => {
    expect(elements(render()).some((element) => element.props.children === "observationOnly")).toBe(true);
    expect(state.preview).not.toHaveBeenCalled();
    state.preview.mockResolvedValue({ rows: [], limit: 100, sampledAt: "now", truncated: false });
    await load();
    expect(state.preview).toHaveBeenCalledOnce();
    expect(elements(render()).some((element) => element.props.children === "empty")).toBe(true);
  });
  it("renders minimal evidence and warns of truncation", async () => {
    state.preview.mockResolvedValue({ rows: [{ id: 17, source: "endpoint", evaluations: [{ templateId: "recovery", result: { status: "matched", reason: "observation" } }] }], limit: 100, sampledAt: "now", truncated: true });
    await load();
    const nodes = elements(render());
    for (const text of ["truncated", "sources.endpoint", "templates.recovery", 17]) expect(nodes.some((element) => element.props.children === text)).toBe(true);
    expect(nodes.filter((element) => element.type === "button")).toHaveLength(1);
  });
  it.each(["rejected", "denied"])("clears old results and shows a generic error when %s", async (kind) => {
    state.preview.mockResolvedValueOnce({ rows: [], limit: 100, sampledAt: "now", truncated: false });
    await load();
    if (kind === "rejected") state.preview.mockRejectedValueOnce(new Error("private detail"));
    else state.preview.mockResolvedValueOnce({ message: "private detail" });
    await load();
    expect(state.values[0]).toBeNull();
    expect(elements(render()).some((element) => element.props.role === "alert" && element.props.children === "error")).toBe(true);
    expect(elements(render()).some((element) => element.type === "table")).toBe(false);
  });
});
