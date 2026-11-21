import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({
  values: [] as unknown[], cursor: 0, cleanups: [] as (() => void)[], busy: false,
  dependencies: [] as unknown[][],
  pending: Promise.resolve(), operations: [] as Promise<unknown>[], mounted: { current: true }, detailRequest: { current: 0 },
  list: vi.fn(), detail: vi.fn(), start: vi.fn(), resume: vi.fn(), request: vi.fn(), options: vi.fn(),
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
  useTransition: () => [state.busy, (run: () => Promise<void>) => {
    state.busy = true;
    const operation = run();
    state.operations.push(operation.catch(() => undefined));
    state.pending = operation.catch(() => undefined).finally(() => { state.busy = false; });
  }],
}));
vi.mock("./time-zone-provider", () => ({ useEpdrTimeZone: () => ({ timeZone: "Asia/Jayapura" }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en", useTranslations: () => state.translate }));
vi.mock("@/actions/epdr-local-playbooks", () => ({
  getEpdrLocalPlaybookRuns: state.list, getEpdrLocalPlaybookRun: state.detail,
  getEpdrLocalPlaybookOptions: state.options, startEpdrLocalPlaybook: state.start, resumeEpdrLocalPlaybook: state.resume,
}));
vi.mock("@/actions/epdr-local-approvals", () => ({ requestEpdrLocalApproval: state.request }));
vi.mock("./incident-handoff", () => ({
  default: function handoff({ detectionId, locale }: { detectionId: number; locale: string }) {
    return { type: "handoff", key: null, props: { detectionId, locale } };
  },
}));
vi.mock("./playbook-version-form", () => ({
  default: function versionForm({ onSaved }: { onSaved?: (saved: { id: number; version: number }) => void }) {
    return { type: "version-form", key: null, props: { onSaved } };
  },
}));
import LocalPlaybookRunner from "./local-playbook-runner";
function render(initialDetectionId?: number) {
  state.cursor = 0;
  return LocalPlaybookRunner({ initialDetectionId, locale: "id" });
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
function click(name: string, tree = render()) {
  const target = elements(tree).find((node) => node.type === "button" && text(node.props.children) === name)!;
  if (!target.props.disabled) (target.props.onClick as () => void)();
}
function submit(tree = render()) {
  (elements(tree).find((node) => node.type === "form")!.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: vi.fn() });
}
async function settle() { await Promise.resolve(); await Promise.resolve(); }
const run = { id: 7, versionId: 42, detectionId: 31, status: "pending", createdAt: "2026-01-01", finishedAt: null };
const storedOptions = {
  versions: [{ id: 42, name: "Malware review", version: 3, templateId: "malware-virus", createdAt: "2026-01-01T00:00:00.000Z",
    compatible: true, incompatibilityReason: null, filters: { category: "all", source: "all", score: "all", minScore: 1, maxScore: 10 } }],
  versionsTruncated: false,
  detections: [{ id: 31, hostName: "Workstation", category: "malware", threatName: "Test threat", score: 8, detectedAt: "2026-01-01T00:00:00.000Z" }],
  detectionTruncated: false, requestedDetection: null, requestedDetectionUnavailable: false,
  eligibility: null,
};
beforeEach(() => {
  vi.resetAllMocks(); state.values = []; state.cursor = 0; state.cleanups = []; state.dependencies = [];
  state.busy = false; state.pending = Promise.resolve(); state.operations = []; state.mounted.current = true; state.detailRequest.current = 0;
  state.list.mockResolvedValue({ rows: [run], total: 1, limit: 50 });
  state.detail.mockResolvedValue({ ...run, steps: [] });
  state.options.mockResolvedValue(storedOptions);
  state.start.mockResolvedValue({ runId: 7, existing: false });
  state.resume.mockResolvedValue({ runId: 7, result: "finished" });
  state.request.mockResolvedValue({ approvalId: 21, existing: false });
});
afterEach(() => { state.cleanups.forEach((cleanup) => cleanup()); state.mounted.current = false; });
describe("local review runner interactions", () => {
  it("loads named choices and evidence only on inspection, never acts on mount", async () => {
    render(31); await settle();
    expect(state.options).toHaveBeenCalledExactlyOnceWith({ detectionId: 31 });
    expect(state.list).toHaveBeenCalledOnce();
    expect(state.detail).not.toHaveBeenCalled(); expect(state.start).not.toHaveBeenCalled(); expect(state.resume).not.toHaveBeenCalled(); expect(state.request).not.toHaveBeenCalled();
    const tree = render(31);
    expect(text(tree)).toContain("detectionOption");
    expect(text(tree)).toContain("versionOption");
  });
  it("keeps a valid requested detection outside the recent selector window", async () => {
    state.options.mockResolvedValue({ ...storedOptions, detections: [], requestedDetection: storedOptions.detections[0] });
    const tree = render(31); await settle();
    const select = elements(render(31)).find((node) => node.type === "select" && node.props["aria-label"] === "detection")!;
    expect(select.props.value).toBe("31");
    expect(text(select)).toContain("detectionOption");
    expect(text(tree)).not.toContain("requestedUnavailable");
  });
  it("does not offer an unavailable URL detection as a valid selection", async () => {
    state.options.mockResolvedValue({ ...storedOptions, requestedDetectionUnavailable: true });
    render(99); await settle();
    const select = elements(render(99)).find((node) => node.type === "select" && node.props["aria-label"] === "detection")!;
    expect(select.props.value).toBe("");
    expect(text(render(99))).toContain("requestedUnavailable");
  });
  it("requires explicit creation, then a separate pending-only recording action", async () => {
    state.detail.mockResolvedValueOnce({ ...run, steps: [] }).mockResolvedValue({ ...run, status: "finished", steps: [] });
    render(31); await settle();
    click("start"); expect(state.start).not.toHaveBeenCalled();
    const checkbox = elements(render(31)).find((node) => node.type === "input" && node.props.type === "checkbox")!;
    (checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    const selects = elements(render(31)).filter((node) => node.type === "select");
    (selects[0].props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "31" } });
    (selects[1].props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "42" } });
    submit(render(31));
    expect(state.start).toHaveBeenCalledExactlyOnceWith({ versionId: 42, detectionId: 31, mode: "local", confirmLocalReview: true });
    expect(state.resume).not.toHaveBeenCalled();
    await state.pending;
    click("resume"); await state.pending;
    expect(state.resume).toHaveBeenCalledExactlyOnceWith(7);
    const tree = render(31);
    expect(text(tree)).toContain("statusHint.finished");
    expect(elements(tree).some((node) => node.type === "button" && text(node.props.children) === "resume")).toBe(false);
  });
  it("explains running without offering a duplicate recording pass", async () => {
    state.detail.mockResolvedValue({ ...run, status: "running", steps: [] });
    render(); await settle(); click("inspect"); await state.pending;
    expect(text(render())).toContain("statusHint.running");
    expect(elements(render()).some((node) => node.type === "button" || node.type === "handoff")).toBe(true);
    expect(elements(render()).some((node) => node.type === "button" && text(node.props.children) === "resume")).toBe(false);
    expect(state.resume).not.toHaveBeenCalled();
  });
  it("shows initial load failure rather than permanent loading and supports retry", async () => {
    state.list.mockRejectedValueOnce(new Error("private")); render(); await settle();
    expect(text(render())).toContain("errors.service_unavailable");
    expect(text(render())).not.toContain("private");
    expect(text(render())).not.toContain("loading");
    click("refresh"); render(); await settle();
    expect(state.list).toHaveBeenCalledTimes(2);
    expect(text(render())).not.toContain("errors.service_unavailable");
  });
  it.each(["invalid_input", "binding_unavailable", "version_unavailable", "detection_unavailable", "service_unavailable"] as const)("shows only actionable %s error", async (code) => {
    state.start.mockResolvedValue({ code, message: "Local playbook unavailable." });
    render(); await settle();
    const checkbox = elements(render()).find((node) => node.type === "input" && node.props.type === "checkbox")!;
    (checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    const selects = elements(render()).filter((node) => node.type === "select");
    (selects[0].props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "31" } });
    (selects[1].props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "42" } });
    submit(); await state.pending;
    expect(text(render())).toContain(`errors.${code}`);
    expect(text(render())).not.toContain("Local playbook unavailable.");
  });
  it("requests a local approval only for an intent the saved review proposed", async () => {
    state.detail.mockResolvedValue({ ...run, steps: [], evidence: {
      responsePolicy: { status: "proposed" }, definition: { template: { steps: ["review", "incident", "scan"] } },
    } });
    render(); await settle(); click("inspect"); await state.pending;
    expect(elements(render()).some((node) => node.type === "button" && text(node.props.children) === "request_scan")).toBe(true);
    expect(elements(render()).some((node) => node.type === "button" && text(node.props.children) === "request_isolate")).toBe(false);
    click("request_scan"); await state.pending;
    expect(state.request).toHaveBeenCalledExactlyOnceWith({ runId: 7, actionIntent: "scan", confirmLocalApproval: true });
    expect(text(render())).toContain("approvalRequested");
  });
  it("displays saved blocked reasons and retains a separate incident handoff", async () => {
    state.detail.mockResolvedValue({ ...run, status: "finished", steps: [{ ordinal: 0, kind: "provider", status: "suppressed", reason: "provider_execution_disabled" }], evidence: {
      responsePolicy: { status: "blocked", reasons: ["identity", "stale"] }, definition: { template: { steps: ["review", "scan"] } },
    } });
    render(); await settle(); click("inspect"); await state.pending;
    const tree = render();
    expect(text(tree)).toContain("policy.blocked");
    expect(text(tree)).toContain("reasons.identity"); expect(text(tree)).toContain("reasons.stale");
    expect(text(tree)).toContain("outcomes.suppressed");
    expect(elements(tree).some((node) => (node.type === "handoff" || (typeof node.type === "function" && node.type.name === "handoff")) && node.props.detectionId === 31 && node.props.locale === "id")).toBe(true);
    expect(elements(tree).some((node) => node.type === "button" && text(node.props.children) === "request_scan")).toBe(false);
    expect(state.request).not.toHaveBeenCalled();
  });
  it("clears stale details when inspection fails", async () => {
    render(); await settle(); click("inspect"); await state.pending;
    state.detail.mockResolvedValueOnce({ message: "unavailable" });
    click("inspect"); await state.pending;
    expect(elements(render()).some((node) => node.type === "button" && text(node.props.children) === "resume")).toBe(false);
    expect(text(render())).toContain("errors.service_unavailable");
  });
  it("keeps only the most recent inspection and ignores stale responses", async () => {
    let resolveFirst!: (value: unknown) => void;
    state.detail.mockReturnValueOnce(new Promise((done) => { resolveFirst = done; }));
    render(); await settle(); click("inspect");
    await vi.waitFor(() => expect(state.detail).toHaveBeenCalledOnce());
    state.detail.mockResolvedValueOnce({ ...run, id: 8, steps: [] });
    state.busy = false;
    click("inspect");
    await vi.waitFor(() => expect(state.detail).toHaveBeenCalledTimes(2));
    await state.pending;
    resolveFirst({ ...run, steps: [] }); await state.pending;
    expect(text(render())).toContain("detail:{\"id\":8}");
    expect(state.resume).not.toHaveBeenCalled();
  });
  it("does not publish in-flight inspection results after unmount", async () => {
    let resolve!: (value: unknown) => void;
    state.detail.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(); await settle(); click("inspect");
    const detailIndex = state.values.findIndex((value) => value === null && state.values.indexOf(value) > 1);
    state.cleanups.forEach((cleanup) => cleanup()); state.mounted.current = false;
    resolve({ ...run, steps: [] }); await state.pending;
    expect(state.values[2]).toBeNull();
    expect(state.resume).not.toHaveBeenCalled();
    expect(detailIndex).toBeLessThan(state.values.length);
  });
  it("pages the run list, mirrors a clamped page and leaves detail untouched", async () => {
    state.list.mockResolvedValue({ rows: [run], total: 120, limit: 50, page: 1, pages: 3 });
    render(); await settle();
    expect(state.list).toHaveBeenLastCalledWith({ page: 1 });
    expect(text(render())).toContain("pageSummary");
    state.list.mockResolvedValue({ rows: [run], total: 120, limit: 50, page: 2, pages: 3 });
    click("next"); render(); await settle();
    expect(state.list).toHaveBeenLastCalledWith({ page: 2 });
    state.list.mockResolvedValue({ rows: [run], total: 120, limit: 50, page: 3, pages: 3 });
    click("next"); render(); await settle();
    expect(state.list).toHaveBeenLastCalledWith({ page: 3 });
    const next = elements(render()).find((node) => node.type === "button" && text(node.props.children) === "next")!;
    expect(next.props.disabled).toBe(true);
    expect(state.detail).not.toHaveBeenCalled();
    expect(state.resume).not.toHaveBeenCalled();
  });

  it("shows eligibility before create and never mutates on mount", async () => {
    state.options.mockResolvedValue({ ...storedOptions, eligibility: {
      versionCompatible: true, incompatibilityReason: null, blocker: null,
      policy: { status: "proposed", reasons: [], route: "operator_incident_pic_review" },
      endpointFacts: { identityKnown: true, endpointRemoved: false, hold: false, critical: false, noAuto: false,
        sourceCompleteness: "verified", fresh: true },
    } });
    render(31); await settle();
    expect(state.start).not.toHaveBeenCalled();
    expect(state.detail).not.toHaveBeenCalled();
    const tree = render(31);
    expect(text(tree)).toContain("eligibility.title");
    expect(text(tree)).toContain("eligibility.ok");
    expect(text(tree)).toContain("eligibility.completeness_verified");
    // A blocker is named before the create button is enabled.
    state.options.mockResolvedValue({ ...storedOptions, eligibility: {
      versionCompatible: true, incompatibilityReason: null, blocker: "detection_outside_configuration",
      policy: null, endpointFacts: null,
    } });
    click("refreshChoices"); await settle();
    render(); await settle();
    expect(text(render(31))).toContain("eligibility.blocker.detection_outside_configuration");
  });

  it("marks the current stage with aria-current and advances through selections", () => {
    const empty = render();
    expect(elements(empty).filter((node) => node.props["aria-current"] === "step")).toHaveLength(1);
    expect(text(elements(empty).find((node) => node.props["aria-current"] === "step")!)).toContain("chooseDetection");
    const detectionSelect = elements(empty).find((node) => node.type === "select" && node.props["aria-label"] === "detection")!;
    (detectionSelect.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "31" } });
    const detectionStage = elements(render()).find((node) => node.props["aria-current"] === "step");
    expect(text(detectionStage!)).toContain("chooseVersion");
  });

  it("clears a stale version selection when a refresh drops it", async () => {
    render(); await settle();
    const selects = elements(render()).filter((node) => node.type === "select");
    (selects[0].props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "31" } });
    (selects[1].props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "42" } });
    // Next options load no longer contains version 42 as compatible.
    state.options.mockResolvedValue({ ...storedOptions,
      versions: [{ ...storedOptions.versions[0]!, id: 43, compatible: false, incompatibilityReason: "definition_changed" }] });
    click("refreshChoices");
    // The guard runs inside the options effect's async continuation: render to
    // trigger it, settle the promise, then read the applied selection.
    render(); await settle();
    const refreshed = elements(render()).find((node) => node.type === "select" && node.props["aria-label"] === "version")!;
    expect(refreshed.props.value).toBe("");
  });

  it("offers inline authoring when no compatible version exists and selects the saved one", async () => {
    state.options.mockResolvedValue({ ...storedOptions,
      versions: [{ ...storedOptions.versions[0]!, compatible: false, incompatibilityReason: "definition_changed" }] });
    render(); await settle();
    expect(text(render())).toContain("authoringTitle");
    // Eligibility needs both a detection and a version; select the detection
    // first so the post-save refresh computes eligibility for the new version.
    const detectionSelect = elements(render()).find((node) => node.type === "select" && node.props["aria-label"] === "detection")!;
    (detectionSelect.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "31" } });
    const form = elements(render()).find((node) => typeof node.type === "function" && typeof node.props.onSaved === "function")!;
    // The post-save options load must contain the new version as compatible,
    // otherwise the membership guard clears it again.
    state.options.mockResolvedValue({ ...storedOptions, versions: [{ ...storedOptions.versions[0]!, id: 44 }] });
    (form.props.onSaved as (saved: { id: number; version: number }) => void)({ id: 44, version: 1 });
    await state.pending;
    // The refresh effect re-queries on the next render; the request carries the
    // newly saved version so eligibility is computed for it immediately.
    render(); await settle();
    expect(state.options).toHaveBeenLastCalledWith(expect.objectContaining({ versionId: 44 }));
    const versionSelect = elements(render()).find((node) => node.type === "select" && node.props["aria-label"] === "version")!;
    expect(versionSelect.props.value).toBe("44");
  });

  it("shows the per-step outcome reason from the engine vocabulary", async () => {
    state.detail.mockResolvedValue({ ...run, status: "finished", steps: [
      { ordinal: 0, kind: "record", status: "recorded", reason: "immutable_evidence_saved" },
    ] });
    render(); await settle(); click("inspect"); await state.pending;
    expect(text(render())).toContain("outcomeReasons.immutable_evidence_saved");
  });

  it.each(["version_definition_changed", "detection_outside_configuration", "detection_outside_template"] as const)(
    "maps %s to its actionable copy", async (code) => {
      state.start.mockResolvedValue({ code, message: "Local playbook unavailable." });
      render(); await settle();
      const checkbox = elements(render()).find((node) => node.type === "input" && node.props.type === "checkbox")!;
      (checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
      const selects = elements(render()).filter((node) => node.type === "select");
      (selects[0].props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "31" } });
      (selects[1].props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "42" } });
      submit(); await state.pending;
      expect(text(render())).toContain(`errors.${code}`);
    });
});
