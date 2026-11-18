import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { WatchGuardSettingsData } from "@/actions/watchguard-settings";

const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, tasks: [] as Promise<unknown>[], save: vi.fn(), test: vi.fn(), clear: vi.fn(), refresh: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => { state.values[index] = typeof value === "function" ? value(state.values[index]) : value; }];
  },
  useRef: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = { current: initial };
    return state.values[index];
  },
  useTransition: () => [false, (run: () => Promise<unknown>) => { state.tasks.push(run()); }],
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/actions/watchguard-settings", () => ({ saveWatchGuardConnection: state.save, testWatchGuardConnection: state.test, clearWatchGuardSecrets: state.clear, saveWatchGuardGlobal: vi.fn() }));
vi.mock("@/components/ui/action-button", () => ({ default: ({ children, ...props }: Record<string, unknown>) => <button {...props}>{children as ReactNode}</button> }));
import WatchGuardWizard from "./watchguard-wizard";

const NativeFormData = globalThis.FormData;
class Input { constructor(public value = "") {} }
let fields: Record<string, Input>;
let data: WatchGuardSettingsData;
const form = { elements: { namedItem: (name: string) => fields[name] } };
function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  if (typeof el.type === "function") return elements((el.type as (props: Record<string, unknown>) => ReactNode)(el.props));
  if (el.type === "form" && typeof el.props.ref === "function") el.props.ref(form);
  return [el, ...elements(el.props.children)];
}
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "object" && "props" in node) return text((node as ReactElement<{ children?: unknown }>).props.children);
  return String(node);
}
function render() { state.cursor = 0; return elements(WatchGuardWizard({ initialData: data })); }
function button(label: string) { const found = render().find((el) => el.type === "button" && text(el.props.children).endsWith(label)); if (!found) throw new Error(label); return found; }
function click(label: string) { const el = button(label); if (!el.props.disabled) (el.props.onClick as () => void)(); }
function edit(name: string, value: string) { fields[name].value = value; const el = render().find((el) => el.type === "form")!; (el.props.onChange as () => void)(); }
const passed = { ok: true, status: 200, kind: null, message: "raw provider secret" };
function result() { return { configured: true, credentialRevision: 2, accountRevision: 3, read: { auth: passed, account: passed, endpointSecurity: passed, threatSync: passed } }; }

beforeEach(() => {
  vi.resetAllMocks(); state.values = [1]; state.cursor = 0; state.tasks = [];
  fields = Object.fromEntries(Object.entries({ watchguardSiteId: "1", watchguardRegion: "jpn", watchguardAccountId: "account", watchguardApiKey: "", watchguardRoAccessId: "", watchguardRoPassword: "", watchguardRwAccessId: "", watchguardRwPassword: "", watchguardEndpointSyncMinutes: "15" }).map(([key, value]) => [key, new Input(value)]));
  vi.stubGlobal("HTMLInputElement", Input);
  vi.stubGlobal("FormData", class extends NativeFormData { constructor(value?: unknown) { super(); if (value) for (const [key, input] of Object.entries(fields)) this.set(key, input.value); } });
  data = { sites: [{ siteId: 1, siteName: "Site", configured: true, enabled: true, region: "jpn", accountId: "account", apiKeyConfigured: true, roConfigured: true, rwConfigured: false, credentialRevision: 2, accountRevision: 3, endpointSyncMinutes: 15, detectionSyncMinutes: 5, lastTestAt: null, lastTestResult: result() }], global: {} as WatchGuardSettingsData["global"] };
  state.save.mockResolvedValue({ success: true }); state.test.mockResolvedValue({ ok: true, testedCredentialRevision: 3, testedAccountRevision: 3 }); state.clear.mockResolvedValue({ success: true });
  click("settings.step4");
});
afterEach(() => vi.unstubAllGlobals());

describe("WatchGuard wizard regression", () => {
  it.each([true, false])("preserves enabled=%s while testing and clears saved secrets", async (enabled) => {
    data.sites[0].enabled = enabled;
    render(); edit("watchguardApiKey", "new-secret"); edit("watchguardRoAccessId", "new-id");
    click("settings.saveAndTest"); await Promise.all(state.tasks);
    expect(state.save.mock.calls[0][1].get("watchguardEnabled")).toBe(enabled ? "on" : "");
    expect(fields.watchguardApiKey.value).toBe(""); expect(fields.watchguardRoAccessId.value).toBe("");
    expect([...state.test.mock.calls[0][1].keys()]).toEqual(["watchguardSiteId"]);
  });
  it("invalidates success only for actual connection edits and blocks activation", () => {
    render(); expect(button("settings.activate").props.disabled).toBe(false);
    edit("watchguardEndpointSyncMinutes", "30"); expect(button("settings.activate").props.disabled).toBe(false);
    edit("watchguardAccountId", "account"); expect(button("settings.activate").props.disabled).toBe(false);
    edit("watchguardAccountId", "changed"); expect(button("settings.activate").props.disabled).toBe(true);
    expect(text(render())).not.toContain("settings.testPass");
  });
  it.each([{}, { credentialRevision: 1, accountRevision: 3 }])("rejects legacy or mismatched revisions %j", (revisions) => {
    data.sites[0].lastTestResult = { read: result().read, ...revisions };
    expect(button("settings.activate").props.disabled).toBe(true);
  });
  it("clears password and access ID fields after clearing secrets", async () => {
    render(); for (const key of ["watchguardApiKey", "watchguardRoAccessId", "watchguardRoPassword", "watchguardRwAccessId", "watchguardRwPassword"]) edit(key, "sensitive");
    click("settings.clearSecrets"); await Promise.all(state.tasks);
    expect(Object.entries(fields).filter(([name]) => /ApiKey|AccessId|Password/.test(name)).every(([, input]) => input.value === "")).toBe(true);
    expect(button("settings.activate").props.disabled).toBe(true);
  });
  it("does not restore stale success while waiting for refreshed test results", async () => {
    render(); edit("watchguardRoPassword", "replacement");
    click("settings.saveAndTest"); await Promise.all(state.tasks);
    expect(button("settings.activate").props.disabled).toBe(true);
    data.sites[0].credentialRevision = 3;
    data.sites[0].lastTestResult = { ...result(), credentialRevision: 3 };
    expect(button("settings.activate").props.disabled).toBe(false);
    click("settings.activate"); await Promise.all(state.tasks);
    expect(state.save.mock.calls[1][1].get("watchguardRoPassword")).toBe("");
  });
  it("keeps edits made during testing stale even after refreshed success", async () => {
    let resolve!: (value: { ok: boolean }) => void;
    state.test.mockReturnValue(new Promise((done) => { resolve = done; }));
    click("settings.saveAndTest"); await Promise.resolve();
    edit("watchguardAccountId", "different-account");
    resolve({ ok: true }); await Promise.all(state.tasks);
    data.sites[0].lastTestResult = result();
    expect(button("settings.activate").props.disabled).toBe(true);
  });
  it.each(["missing", "failed", "skipped", "passed"])("requires configured RW checks to pass: %s", (outcome) => {
    data.sites[0].rwConfigured = true;
    data.sites[0].lastTestResult = { ...result(), ...(outcome === "missing" ? {} : {
      write: { ...result().read, auth: { ...passed, ok: outcome === "passed", skipped: outcome === "skipped" } },
    }) };
    expect(button("settings.activate").props.disabled).toBe(outcome !== "passed");
  });
  it("allows RO-only activation when unconfigured write checks are skipped", () => {
    data.sites[0].lastTestResult = { ...result(), write: { ...result().read, auth: { ...passed, ok: false, skipped: true } } };
    expect(button("settings.activate").props.disabled).toBe(false);
  });
  it.each([{ ok: false }, { ok: true }])("keeps a response without tested revisions invalidated: %j", async (response) => {
    state.test.mockResolvedValue(response);
    click("settings.saveAndTest"); await Promise.all(state.tasks);
    // A refresh may deserialize the old persisted success as a new object.
    data.sites[0].lastTestResult = result();
    expect(button("settings.activate").props.disabled).toBe(true);
  });
  it("preserves sensitive edits made while save is pending", async () => {
    let resolve!: (value: { success: boolean }) => void;
    state.save.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    edit("watchguardRoPassword", "submitted"); click("settings.saveAndTest");
    edit("watchguardRoPassword", "new-unsaved-value");
    resolve({ success: true }); await Promise.all(state.tasks);
    data.sites[0].lastTestResult = result();
    expect(fields.watchguardRoPassword.value).toBe("new-unsaved-value");
    expect(button("settings.activate").props.disabled).toBe(true);
  });
  it("renders read/write status and skipped checks without raw provider messages", () => {
    data.sites[0].lastTestResult = { ...result(), credentialSources: { read: "rw" }, unresolved: { write: "missing_write_credentials" }, write: { ...result().read, account: { ...passed, ok: false, skipped: true, stage: "rest", status: null } } };
    const content = text(render());
    expect(content).toContain("settings.readResults"); expect(content).toContain("settings.writeResults");
    expect(content).toContain("settings.skipped"); expect(content).toContain("rest");
    expect(content).toContain("settings.credentialSource.rw"); expect(content).toContain("settings.resolveReason.missing_write_credentials");
    expect(content).toContain("settings.httpStatus");
    expect(content).not.toContain("raw provider secret");
  });
});
