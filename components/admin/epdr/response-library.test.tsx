import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  values: [] as unknown[], cursor: 0, dependencies: undefined as unknown[] | undefined,
  cleanup: undefined as (() => void) | undefined,
  bindings: vi.fn(), history: vi.fn(), recommendations: vi.fn(), create: vi.fn(), toggle: vi.fn(), request: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => { state.values[index] = typeof value === "function" ? (value as (v: unknown) => unknown)(state.values[index]) : value; }];
  },
  useTransition: () => [false, (run: () => Promise<void>) => { return run(); }],
  useEffect: (run: () => () => void, dependencies: unknown[]) => {
    if (!state.dependencies || dependencies.some((value, index) => value !== state.dependencies?.[index])) {
      state.cleanup?.(); state.dependencies = dependencies; state.cleanup = run();
    }
  },
  useCallback: (fn: unknown) => fn,
}));
const translate = Object.assign((key: string) => key, { has: () => false });
vi.mock("next-intl", () => ({ useLocale: () => "id", useTranslations: () => translate }));
vi.mock("@/actions/epdr-responses", () => ({
  getEpdrResponseBindings: state.bindings, getEpdrResponseRecommendations: state.recommendations,
  createEpdrResponseBinding: state.create, setEpdrResponseBindingState: state.toggle,
}));
vi.mock("@/actions/epdr-executions", () => ({ createEpdrExecutionRequest: state.request }));
vi.mock("@/actions/epdr-playbook-history", () => ({ getEpdrPlaybookHistory: state.history }));
vi.mock("./time-zone-provider", () => ({ useEpdrTimeZone: () => ({ timeZone: "Asia/Jakarta" }) }));
import ResponseLibrary from "./response-library";

function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const item = node as ReactElement<Record<string, unknown>>;
  return [item, ...elements(item.props.children)];
}
function strings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(strings);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return strings((node as ReactElement<Record<string, unknown>>).props.children);
}
function render() { state.cursor = 0; return ResponseLibrary(); }
async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); }

const binding = { id: 4, version_id: 2, response: "scan", state: "active", account_revision: 3,
  activated_at: "2026-01-01T00:00:00Z", evaluation_after: "2026-01-01T00:00:00Z",
  name: "Contain", template_id: "contain", version: 5, current_connection: true };
const recommendation = { id: 9, detection_id: 31, endpoint_id: 7, response: "scan", status: "matched",
  created_at: "2026-01-02T00:00:00Z", reasons: [], request_id: null };

beforeEach(() => {
  state.cleanup?.(); state.values = []; state.cursor = 0; state.dependencies = undefined; state.cleanup = undefined;
  vi.resetAllMocks();
  state.bindings.mockResolvedValue({ bindings: [binding] });
  state.history.mockResolvedValue({ versions: [{ id: 2, templateId: "contain", name: "Contain", version: 5, createdAt: "2026-01-01T00:00:00Z" }] });
  state.recommendations.mockResolvedValue({ recommendations: [recommendation] });
});

describe("operational response library", () => {
  it("shows active bindings and recommendation request actions", async () => {
    render(); await settle(); const tree = render();
    const text = strings(tree).join(" ");
    expect(text).toContain("Contain");
    expect(text).toContain("stateActive");
    expect(text).toContain("matched");
    expect(elements(tree).filter((item) => item.type === "button").map((item) => item.props.children)).toContain("request");
  });

  it("requires the recommendation-only confirmation before creating a binding", async () => {
    render(); await settle(); let tree = render();
    const create = elements(tree).find((item) => item.type === "button" && item.props.children === "create")!;
    expect(create.props.disabled).toBe(true);
    const version = elements(tree).find((item) => item.type === "select"
      && strings(item).includes("versionOption"))!;
    (version.props.onChange as (event: unknown) => void)({ target: { value: "2" } });
    tree = render();
    const checkbox = elements(tree).find((item) => item.type === "input" && item.props.type === "checkbox")!;
    (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    tree = render();
    const enabled = elements(tree).find((item) => item.type === "button" && item.props.children === "create")!;
    expect(enabled.props.disabled).toBe(false);
    state.create.mockResolvedValue({ bindingId: 10 });
    (enabled.props.onClick as () => void)();
    await settle();
    expect(state.create).toHaveBeenCalledWith({ versionId: 2, response: "scan", confirmRecommendationOnly: true });
  });

  it("requires a second confirmation before requesting execution for a recommendation", async () => {
    render(); await settle(); let tree = render();
    const button = elements(tree).find((item) => item.type === "button" && item.props.children === "request")!;
    (button.props.onClick as () => void)();
    tree = render();
    expect(state.request).not.toHaveBeenCalled();
    const confirm = elements(tree).find((item) => item.type === "button" && item.props.children === "confirmRequest")!;
    state.request.mockResolvedValue({ requestId: 12 });
    (confirm.props.onClick as () => void)();
    await settle();
    expect(state.request).toHaveBeenCalledWith({ endpointId: 7, actionType: "scan",
      confirmExecutionRequest: true, recommendationId: 9 });
  });

  it("shows a bounded error and never a raw server message when the request is rejected", async () => {
    render(); await settle(); let tree = render();
    (elements(tree).find((item) => item.type === "button" && item.props.children === "request")!.props.onClick as () => void)();
    tree = render();
    state.request.mockResolvedValue({ code: "state_conflict" });
    (elements(tree).find((item) => item.type === "button" && item.props.children === "confirmRequest")!.props.onClick as () => void)();
    await settle();
    expect(strings(render()).join(" ")).toContain("errorStale");
  });

  it("keeps a paused binding on a changed connection from resuming", async () => {
    state.bindings.mockResolvedValue({ bindings: [{ ...binding, state: "paused", current_connection: false }] });
    render(); await settle();
    const resume = elements(render()).find((item) => item.type === "button" && item.props.children === "resume")!;
    expect(resume.props.disabled).toBe(true);
  });
});

describe("operational response library failures", () => {
  it("reports a failed recommendation read instead of an empty history", async () => {
    state.recommendations.mockResolvedValue({ code: "unavailable" });
    render(); await settle();
    const text = strings(render()).join(" ");
    expect(text).toContain("error");
    expect(text).not.toContain("recEmpty");
  });
});
