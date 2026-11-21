import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  cleanups: [] as (() => void)[],
  dependencies: [] as unknown[][],
  pending: Promise.resolve(),
  mounted: { current: true },
  detailRequest: { current: 0 },
  options: vi.fn(),
  settings: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  resolve: vi.fn(),
  saveSettings: vi.fn(),
  translate: (key: string, values?: Record<string, string | number>) => values ? `${key}:${JSON.stringify(values)}` : key,
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
  useEffect: (run: () => void | (() => void), dependencies: unknown[]) => {
    const index = state.cursor++;
    const previous = state.dependencies[index];
    if (!previous || previous.length !== dependencies.length || dependencies.some((value, slot) => !Object.is(value, previous[slot]))) {
      state.dependencies[index] = dependencies;
      const cleanup = run();
      if (typeof cleanup === "function") state.cleanups.push(cleanup);
    }
  },
  useRef: (initial: unknown) => initial === true ? state.mounted : initial === 0 ? state.detailRequest : { current: initial },
  useTransition: () => [false, (run: () => Promise<void>) => { state.pending = Promise.resolve(run()).catch(() => undefined); }],
}));
vi.mock("next-intl", () => ({ useTranslations: () => state.translate }));
vi.mock("@/actions/epdr-executions", () => ({
  getEpdrExecutionOptions: state.options,
  getEpdrExecutionRequests: state.list,
  getEpdrExecutionRequest: state.detail,
  createEpdrExecutionRequest: state.create,
  approveEpdrExecutionRequest: state.approve,
  rejectEpdrExecutionRequest: state.reject,
  resolveEpdrExecutionReview: state.resolve,
}));
vi.mock("@/actions/epdr-write-settings", () => ({
  getEpdrWriteSettings: state.settings,
  saveEpdrWriteSettings: state.saveSettings,
}));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("./time-zone-provider", () => ({ useEpdrTimeZone: () => ({ timeZone: "Asia/Jakarta" }) }));

import ExecutionCenter from "./execution-center";

let prefill: { endpointId?: number; actionType?: string } = {};
function render() {
  state.cursor = 0;
  return ExecutionCenter({ locale: "en", prefill });
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
function button(tree: unknown, label: string) {
  return elements(tree).find((node) => node.type === "button" && text(node.props.children) === label);
}
function click(tree: unknown, label: string) {
  const target = button(tree, label);
  if (!target) throw new Error(`missing button ${label}`);
  if (!target.props.disabled) (target.props.onClick as () => void)();
}
async function settle() { await Promise.resolve(); await Promise.resolve(); }

const pendingRequest = { id: 5, actionType: "scan", state: "pending_approval", endpointId: 2 };
const detailPending = {
  ...pendingRequest, createdAt: "2026-01-01T00:00:00.000Z", approvedAt: null, approvalExpiresAt: null,
  stateHint: "", outcomeUnknownReason: null, requestedBy: 1, approvedBy: null, snapshotHash: "hash",
  parameters: {}, providerRef: null, namespace: "endpoint_security",
  target: { deviceId: "dev-1", entityId: null, providerIncidentId: null },
  accountRevision: 1, credentialRevision: 2, evidenceGeneration: 3,
  expiresAt: "2026-01-01T01:00:00.000Z", reviewReason: null, attempts: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  state.values = []; state.cursor = 0; state.cleanups = []; state.dependencies = [];
  state.pending = Promise.resolve(); state.mounted.current = true; state.detailRequest.current = 0; prefill = {};
  vi.stubGlobal("setInterval", () => 0);
  vi.stubGlobal("clearInterval", () => undefined);
  state.options.mockResolvedValue({
    writeEnabled: true, disabledReasons: [], approvalExpiryMinutes: 60,
    limits: { maxActionsPerHour: 30, cooldownMinutes: 10, siteMaxActionsPerHour: null },
    actions: [{ actionType: "scan", namespace: "endpoint_security", highImpact: false, observationSupport: "automatic", requiredParams: [], allowedParams: ["scan_scope"] }],
    endpoints: [{ id: 2, hostName: "host", isolationState: 0, hold: false, dataFresh: true }],
  });
  state.settings.mockResolvedValue({
    globalEnabled: true, siteEnabled: true, globalKillSwitch: false, siteKillSwitch: false,
    globalAllowedActions: ["scan"], siteAllowedActions: ["scan"], approvalExpiryMinutes: 60,
    globalMaxActionsPerHour: 30, siteMaxActionsPerHour: null, executionCooldownMinutes: 10,
    isSuperadmin: false, availableActions: ["scan"],
  });
  state.list.mockResolvedValue({ rows: [pendingRequest], page: 1, pages: 1, total: 1 });
  state.detail.mockResolvedValue(detailPending);
  state.approve.mockResolvedValue({ state: "queued" });
});

afterEach(() => {
  state.cleanups.forEach((cleanup) => cleanup());
  state.mounted.current = false;
  vi.unstubAllGlobals();
});

describe("execution center safety", () => {
  it("prioritizes the queue, discloses manual requests and filters current-page statuses", async () => {
    state.list.mockResolvedValue({ rows: [pendingRequest, { ...pendingRequest, id: 6, state: "dispatching" }, { ...pendingRequest, id: 7, state: "in_progress" }], page: 1, pages: 2, total: 30 });
    render(); await settle();
    const tree = render();
    expect(text(tree).indexOf("listTitle")).toBeLessThan(text(tree).indexOf("manualRequest"));
    const disclosure = elements(tree).find((node) => node.type === "details" && text(node).includes("manualRequest"));
    expect(disclosure?.props.open).toBeUndefined();
    click(tree, "queue.active");
    const filtered = render();
    expect(text(filtered)).not.toContain('row:{"id":5}');
    expect(text(filtered)).toContain('row:{"id":6}');
    expect(text(filtered)).toContain('row:{"id":7}');
    expect(text(filtered)).toContain("pageFilterHint");
    expect(state.list).toHaveBeenCalledExactlyOnceWith({ page: 1 });
  });
  it("loads data only, without creating or approving on mount", async () => {
    render();
    await settle();
    expect(state.options).toHaveBeenCalledOnce();
    expect(state.list).toHaveBeenCalledOnce();
    expect(state.create).not.toHaveBeenCalled();
    expect(state.approve).not.toHaveBeenCalled();
    expect(state.reject).not.toHaveBeenCalled();
  });

  it("does not offer approval from the list before inspection", async () => {
    render();
    await settle();
    const tree = render();
    expect(button(tree, "approve")).toBeUndefined();
    click(tree, "inspect");
    await state.pending;
    expect(state.detail).toHaveBeenCalledWith(5);
    expect(button(render(), "approve")).toBeDefined();
  });

  it("requires an explicit approval confirmation checkbox", async () => {
    render();
    await settle();
    click(render(), "inspect");
    await state.pending;
    const approve = button(render(), "approve")!;
    expect(approve.props.disabled).toBe(true);
    // The approval confirmation is the last checkbox in the detail panel.
    const checkbox = elements(render()).filter((node) => node.type === "input" && node.props.type === "checkbox").pop()!;
    (checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    click(render(), "approve");
    await state.pending;
    expect(state.approve).toHaveBeenCalledWith({ requestId: 5, confirmApproval: true });
  });

  it("still publishes the approval result after a StrictMode effect replay", async () => {
    render();
    await settle();
    // Replay setup → cleanup → setup, as React StrictMode does in development.
    state.cleanups.forEach((cleanup) => cleanup());
    state.dependencies = [];
    render();
    await settle();
    click(render(), "inspect");
    await state.pending;
    const checkbox = elements(render()).filter((node) => node.type === "input" && node.props.type === "checkbox").pop()!;
    (checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    click(render(), "approve");
    await state.pending;
    expect(state.approve).toHaveBeenCalledOnce();
    // A stale mount ref would drop the follow-up detail refresh.
    expect(state.detail).toHaveBeenCalled();
    expect(text(render())).not.toContain("errors.forbidden");
  });

  it("leaves write enablement to the settings page", async () => {
    render();
    await settle();
    expect(state.settings).not.toHaveBeenCalled();
    expect(text(render())).not.toContain("settings.title");
  });

  it("links to execution settings when writes are disabled", async () => {
    state.options.mockResolvedValue({ ...(await state.options()), writeEnabled: false, disabledReasons: ["site_writes_disabled"], actions: [] });
    state.options.mockClear();
    render();
    await settle();
    const link = elements(render()).find((node) => node.type === "a" && node.props.children === "settingsLink");
    expect(link?.props.href).toBe("/en/admin/epdr/settings#provider-execution");
  });

  it("prefills only offered values and never submits on its own", async () => {
    prefill = { endpointId: 2, actionType: "scan" };
    render();
    await settle();
    render();
    const tree = render();
    const selects = elements(tree).filter((node) => node.type === "select");
    expect(selects[0].props.value).toBe("2");
    expect(selects[1].props.value).toBe("scan");
    expect(text(tree)).toContain("prefilled");
    const confirm = elements(tree).filter((node) => node.type === "input" && node.props.type === "checkbox").pop()!;
    expect(confirm.props.checked).toBe(false);
    expect(state.create).not.toHaveBeenCalled();
  });

  it("ignores a prefill for an endpoint or action not offered", async () => {
    prefill = { endpointId: 999, actionType: "reboot" };
    render();
    await settle();
    render();
    const selects = elements(render()).filter((node) => node.type === "select");
    expect(selects[0].props.value).toBe("");
    expect(selects[1].props.value).toBe("");
    expect(text(render())).not.toContain("prefilled");
  });

  it("resets request confirmation when a parameter changes", async () => {
    render();
    await settle();
    const actionSelect = elements(render()).find((node) => node.type === "select" && node.props.value === "")!;
    (actionSelect.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "scan" } });
    const checkboxes = elements(render()).filter((node) => node.type === "input" && node.props.type === "checkbox");
    const confirmed = checkboxes[checkboxes.length - 1]!;
    (confirmed.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    const scope = elements(render()).find((node) => node.type === "select" && node.props.value === "")!;
    (scope.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "1" } });
    const after = elements(render()).filter((node) => node.type === "input" && node.props.type === "checkbox").pop()!;
    expect(after.props.checked).toBe(false);
  });
});
