import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  cleanups: [] as (() => void)[],
  dependencies: [] as unknown[][],
  pending: Promise.resolve(),
  mounted: { current: true },
  load: vi.fn(),
  save: vi.fn(),
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
    if (!previous || dependencies.some((value, slot) => !Object.is(value, previous[slot]))) {
      state.dependencies[index] = dependencies;
      const cleanup = run();
      if (typeof cleanup === "function") state.cleanups.push(cleanup);
    }
  },
  useRef: () => state.mounted,
  useTransition: () => [false, (run: () => Promise<void>) => { state.pending = Promise.resolve(run()).catch(() => undefined); }],
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/actions/epdr-write-settings", () => ({ getEpdrWriteSettings: state.load, saveEpdrWriteSettings: state.save }));

import WriteEnablementPanel from "./write-enablement-panel";

function render() { state.cursor = 0; return WriteEnablementPanel(); }
function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children)];
}
function checkboxes(tree: unknown) { return elements(tree).filter((node) => node.type === "input" && node.props.type === "checkbox"); }
function saveButton(tree: unknown) { return elements(tree).find((node) => node.type === "button")!; }
async function settle() { await Promise.resolve(); await Promise.resolve(); }

const settings = {
  globalEnabled: false, siteEnabled: false, globalKillSwitch: false, siteKillSwitch: false,
  globalAllowedActions: ["scan"], siteAllowedActions: [], approvalExpiryMinutes: 60,
  globalMaxActionsPerHour: 30, siteMaxActionsPerHour: null, executionCooldownMinutes: 10,
  isSuperadmin: false, availableActions: ["scan", "isolate"],
};

beforeEach(() => {
  vi.resetAllMocks();
  state.values = []; state.cursor = 0; state.cleanups = []; state.dependencies = [];
  state.pending = Promise.resolve(); state.mounted.current = true;
  state.load.mockResolvedValue(settings);
  state.save.mockResolvedValue({ ok: true });
});
afterEach(() => { state.cleanups.forEach((cleanup) => cleanup()); });

describe("write enablement panel", () => {
  it("loads settings without saving and hides deployment controls from site admins", async () => {
    render(); await settle();
    const tree = render();
    expect(state.load).toHaveBeenCalledOnce();
    expect(state.save).not.toHaveBeenCalled();
    // site toggle + two site actions + confirmation; no global toggle or ceiling.
    expect(checkboxes(tree)).toHaveLength(4);
    expect(saveButton(tree).props.disabled).toBe(true);
  });

  it("saves only after explicit confirmation and never sends deployment fields for a site admin", async () => {
    render(); await settle();
    const [site, scan, , confirm] = checkboxes(render());
    (site.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    (scan.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    (confirm.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    (saveButton(render()).props.onClick as () => void)();
    await state.pending;
    expect(state.save).toHaveBeenCalledExactlyOnceWith({
      siteEnabled: true, siteAllowedActions: ["scan"], siteMaxActionsPerHour: null,
      executionCooldownMinutes: 10, confirmWriteEnablement: true,
    });
  });

  it("shows global permissions to site admins without enabling gates when actions change", async () => {
    render(); await settle();
    const tree = render();
    expect(elements(tree).some((node) => node.type === "table")).toBe(true);
    expect(elements(tree).some((node) => node.type === "p" && node.props.children === "globalCap")).toBe(true);
    const [site, scan, , confirm] = checkboxes(tree);
    (confirm.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    (scan.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    expect(checkboxes(render())[0].props.checked).toBe(site.props.checked);
    expect(checkboxes(render()).at(-1)?.props.checked).toBe(false);
    expect(saveButton(render()).props.disabled).toBe(true);
    expect(state.save).not.toHaveBeenCalled();
  });

  it("reports cap and cooldown errors next to their fields without saving", async () => {
    render(); await settle();
    const fields = elements(render()).filter((node) => node.type === "input" && node.props.type === "number");
    (fields[0].props.onChange as (event: unknown) => void)({ target: { value: "31" } });
    (fields[1].props.onChange as (event: unknown) => void)({ target: { value: "" } });
    (checkboxes(render()).at(-1)!.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    (saveButton(render()).props.onClick as () => void)();
    await state.pending;
    const invalid = elements(render()).filter((node) => node.type === "input" && node.props["aria-invalid"]);
    expect(invalid).toHaveLength(2);
    expect(invalid.map((node) => node.props["aria-describedby"])).toEqual(["epdr-cap-error", "epdr-cooldown-error"]);
    expect(state.save).not.toHaveBeenCalled();
  });

  it("shows a bounded error when settings cannot be loaded", async () => {
    state.load.mockResolvedValue({ code: "forbidden" });
    render(); await settle();
    const alert = elements(render()).find((node) => node.props.role === "alert");
    expect(alert?.props.children).toBe("errors.forbidden");
    expect(checkboxes(render())).toHaveLength(0);
  });
});
