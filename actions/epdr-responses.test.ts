import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), execute: vi.fn(), actor: vi.fn() }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAdminAction: mocks.guard }));
vi.mock("@/db", () => ({ db: { transaction: async (fn: (tx: unknown) => unknown) => fn({ execute: mocks.execute }) } }));
vi.mock("@/lib/epdr/read-sync-queue", () => ({ assertReadSyncActor: mocks.actor }));
import { createEpdrResponseBinding, getEpdrResponseRecommendations, setEpdrResponseBindingState } from "./epdr-responses";
import { PLAYBOOK_TEMPLATES } from "@/lib/epdr/playbooks";
const template = PLAYBOOK_TEMPLATES.find((t) => t.id === "malware-virus")!;
const version = { configuration: { templateId: template.id, name: "Saved", mode: "simulate", filters: { source: "all", category: "all", score: "all", minScore: 1, maxScore: 10 } }, definition: { schemaVersion: 1, template } };
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 7, session: { userId: 9 } }); });
describe("response server actions", () => {
  it("rejects unauthorized callers before touching storage", async () => {
    mocks.guard.mockResolvedValue({ ok: false });
    expect(await createEpdrResponseBinding({})).toEqual({ code: "forbidden" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rejects caller supplied execution inputs and implicit backfill", async () => {
    expect(await createEpdrResponseBinding({ versionId: 1, response: "scan", confirmRecommendationOnly: true, backfill: true })).toEqual({ code: "invalid_input" });
    expect(await getEpdrResponseRecommendations({ siteId: 8 })).toEqual({ code: "invalid_input" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("binds an exact immutable version under actor and connection locks", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 3, account_revision: 0 }] }).mockResolvedValueOnce({ rows: [version] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }).mockResolvedValueOnce({ rows: [{ id: 12 }] });
    expect(await createEpdrResponseBinding({ versionId: 2, response: "isolate", confirmRecommendationOnly: true })).toEqual({ bindingId: 12 });
    expect(mocks.actor).toHaveBeenCalledWith(expect.anything(), 7, 9);
  });
  it("does not rebind a stale account on resume", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 3, account_revision: 2 }] }).mockResolvedValueOnce({ rows: [{ count: 0 }] }).mockResolvedValueOnce({ rows: [] });
    expect(await setEpdrResponseBindingState({ bindingId: 1, state: "active" })).toEqual({ code: "not_found" });
  });
});

describe("response action failure handling", () => {
  it("returns a bounded code instead of throwing when the actor is revoked or storage fails", async () => {
    mocks.actor.mockRejectedValue(new Error("private sqlstate detail"));
    mocks.execute.mockResolvedValue({ rows: [{ id: 3, account_revision: 0 }] });
    expect(await getEpdrResponseRecommendations({})).toEqual({ code: "unavailable" });
    expect(await setEpdrResponseBindingState({ bindingId: 1, state: "paused" })).toEqual({ code: "unavailable" });
    expect(await createEpdrResponseBinding({ versionId: 2, response: "scan", confirmRecommendationOnly: true })).toEqual({ code: "unavailable" });
  });
});
