import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActiveSiteAdminAction: vi.fn(async (..._args: unknown[]) => ({
    ok: true,
    session: { userId: 1, username: "u", role: "admin" },
    activeSiteId: 1,
  })),
  resolveNcmConfig: vi.fn(async (..._args: unknown[]) => ({ url: "http://10.0.0.9:9443", adminApiKey: "k" })),
  fetchNcmSwitches: vi.fn(async (..._args: unknown[]) => []),
  fetchNcmJobs: vi.fn(async (..._args: unknown[]) => []),
  fetchNcmBackups: vi.fn(async (..._args: unknown[]) => []),
  fetchNcmBaselines: vi.fn(async (..._args: unknown[]) => []),
  fetchNcmReviews: vi.fn(async (..._args: unknown[]) => []),
  fetchNcmCredentials: vi.fn(async (..._args: unknown[]) => []),
  createNcmSwitch: vi.fn(async (..._args: unknown[]) => ({ id: 1 })),
  updateNcmSwitch: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
  deleteNcmSwitch: vi.fn(async (..._args: unknown[]) => null),
  updateNcmCredentials: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
  createNcmCredential: vi.fn(async (..._args: unknown[]) => ({ id: 1 })),
  updateNcmCredential: vi.fn(async (..._args: unknown[]) => ({ id: 1 })),
  deleteNcmCredential: vi.fn(async (..._args: unknown[]) => null),
  fetchNcmBackupContent: vi.fn(async (..._args: unknown[]) => "hostname SW-CORE-01"),
  updateNcmJob: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
  triggerNcmBackup: vi.fn(async (..._args: unknown[]) => ({ backup_id: 8 })),
  createNcmBaseline: vi.fn(async (..._args: unknown[]) => ({ id: 2 })),
  fetchNcmReview: vi.fn(async (..._args: unknown[]) => "--- a\n+++ b"),
  decideNcmReview: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
  getNcmLastSeen: vi.fn(async (..._args: unknown[]) => null),
  touchNcmLastSeen: vi.fn(async (..._args: unknown[]) => undefined),
  logAudit: vi.fn(async (..._args: unknown[]) => undefined),
  revalidatePath: vi.fn((..._args: unknown[]) => undefined),
}));

// Mock guards so the SUT never needs a live session.
vi.mock("@/lib/action-auth", () => ({
  requireActiveSiteAdminAction: (...args: unknown[]) =>
    mocks.requireActiveSiteAdminAction(...args),
}));

vi.mock("@/lib/ncm", () => ({
  resolveNcmConfig: (...args: unknown[]) => mocks.resolveNcmConfig(...args),
  fetchNcmSwitches: (...args: unknown[]) => mocks.fetchNcmSwitches(...args),
  fetchNcmJobs: (...args: unknown[]) => mocks.fetchNcmJobs(...args),
  fetchNcmBackups: (...args: unknown[]) => mocks.fetchNcmBackups(...args),
  fetchNcmBaselines: (...args: unknown[]) => mocks.fetchNcmBaselines(...args),
  fetchNcmReviews: (...args: unknown[]) => mocks.fetchNcmReviews(...args),
  fetchNcmCredentials: (...args: unknown[]) => mocks.fetchNcmCredentials(...args),
  createNcmSwitch: (...args: unknown[]) => mocks.createNcmSwitch(...args),
  updateNcmSwitch: (...args: unknown[]) => mocks.updateNcmSwitch(...args),
  deleteNcmSwitch: (...args: unknown[]) => mocks.deleteNcmSwitch(...args),
  updateNcmCredentials: (...args: unknown[]) => mocks.updateNcmCredentials(...args),
  createNcmCredential: (...args: unknown[]) => mocks.createNcmCredential(...args),
  updateNcmCredential: (...args: unknown[]) => mocks.updateNcmCredential(...args),
  deleteNcmCredential: (...args: unknown[]) => mocks.deleteNcmCredential(...args),
  fetchNcmBackupContent: (...args: unknown[]) => mocks.fetchNcmBackupContent(...args),
  updateNcmJob: (...args: unknown[]) => mocks.updateNcmJob(...args),
  triggerNcmBackup: (...args: unknown[]) => mocks.triggerNcmBackup(...args),
  createNcmBaseline: (...args: unknown[]) => mocks.createNcmBaseline(...args),
  fetchNcmReview: (...args: unknown[]) => mocks.fetchNcmReview(...args),
  decideNcmReview: (...args: unknown[]) => mocks.decideNcmReview(...args),
  getNcmLastSeen: (...args: unknown[]) => mocks.getNcmLastSeen(...args),
  touchNcmLastSeen: (...args: unknown[]) => mocks.touchNcmLastSeen(...args),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: (...args: unknown[]) => mocks.logAudit(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mocks.revalidatePath(...args),
}));

import {
  addNcmCredential,
  addNcmSwitch,
  createNcmBaseline,
  decideNcmReview,
  deleteNcmCredentialAction,
  deleteNcmSwitch,
  getNcmBackupContent,
  getNcmOverview,
  getNcmReviewDetail,
  rotateNcmCredentials,
  triggerNcmBackup,
  updateNcmCredentialAction,
  updateNcmSchedule,
  updateNcmSwitch,
} from "./ncm";

function form(values: Record<string, string | number>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.append(key, String(value));
  return fd;
}

async function okForm(promise: Promise<unknown>) {
  await expect(promise).resolves.toMatchObject({ success: true });
}

function denyGuard() {
  mocks.requireActiveSiteAdminAction.mockResolvedValueOnce({
    ok: false,
    message: "Unauthorized. Active-site admin access required.",
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("getNcmOverview", () => {
  it("returns unconfigured without calling NCM when no config row exists", async () => {
    mocks.resolveNcmConfig.mockResolvedValueOnce({ url: null, adminApiKey: "k" } as never);

    const result = await getNcmOverview();

    expect(result).toMatchObject({ status: "unconfigured" });
    expect(mocks.fetchNcmSwitches).not.toHaveBeenCalled();
  });

  it("returns live fleet data and stamps lastSeen on success", async () => {
    mocks.fetchNcmSwitches.mockResolvedValueOnce([{ id: 1 }] as never);

    const result = await getNcmOverview();

    expect(result).toMatchObject({ status: "online" });
    expect(mocks.touchNcmLastSeen).toHaveBeenCalledWith(1);
  });

  it("returns offline with the last-seen heartbeat when NCM is unreachable", async () => {
    const seen = new Date("2026-09-09T10:00:00Z");
    mocks.getNcmLastSeen.mockResolvedValueOnce(seen as never);
    mocks.fetchNcmSwitches.mockRejectedValueOnce(new Error("Gagal terhubung ke http://x: fetch failed"));

    const result = await getNcmOverview();

    expect(result).toMatchObject({ status: "offline" });
    expect((result as { lastSeenAt: unknown }).lastSeenAt).toBe(seen.toISOString());
    expect(mocks.touchNcmLastSeen).not.toHaveBeenCalled();
  });
});

describe("write actions", () => {
  it("rejects when the caller lacks active-site admin access", async () => {
    denyGuard();

    const result = await addNcmSwitch(undefined, form({ name: "core-1", ip: "10.0.0.3" }));

    expect(result).toMatchObject({ message: expect.stringContaining("Unauthorized") });
    expect(mocks.createNcmSwitch).not.toHaveBeenCalled();
  });

  it("adds a switch and audits with revalidation", async () => {
    const result = await addNcmSwitch(undefined, form({ name: "core-1", ip: "10.0.0.3" }));

    expect(result).toMatchObject({ success: true });
    expect(mocks.createNcmSwitch).toHaveBeenCalledWith(
      { url: "http://10.0.0.9:9443", adminApiKey: "k" },
      expect.objectContaining({ name: "core-1", ip: "10.0.0.3" }),
    );
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CREATE", entity: "ncm_switch" }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/ncm");
  });

  it("validates the switch payload before calling NCM", async () => {
    const result = await addNcmSwitch(undefined, form({ name: "", ip: "not-an-ip" }));

    expect(result).toMatchObject({ message: expect.any(String) });
    expect(mocks.createNcmSwitch).not.toHaveBeenCalled();
  });

  it("updates and deletes switches", async () => {
    await okForm(updateNcmSwitch(undefined, form({ id: "3", name: "core-1b" })));
    await okForm(deleteNcmSwitch(undefined, form({ id: "3" })));
    expect(mocks.updateNcmSwitch).toHaveBeenCalledWith(
      expect.anything(),
      3,
      expect.objectContaining({ name: "core-1b" }),
    );
    expect(mocks.deleteNcmSwitch).toHaveBeenCalledWith(expect.anything(), 3);
  });

  it("rotates credentials without leaking the password to audit or messages", async () => {
    const result = await rotateNcmCredentials(
      undefined,
      form({ switchId: "3", username: "admin", password: "r0tated-super-secret!" }),
    );

    expect(result).toMatchObject({ success: true });
    expect(mocks.updateNcmCredentials).toHaveBeenCalledWith(
      expect.anything(),
      3,
      expect.objectContaining({ password: "r0tated-super-secret!" }),
    );
    const audited = JSON.stringify(mocks.logAudit.mock.calls) + JSON.stringify(result);
    expect(audited).not.toContain("r0tated-super-secret!");
  });

  it("updates a schedule and triggers a backup", async () => {
    await okForm(updateNcmSchedule(undefined, form({ jobId: "9", schedule: "0 3 * * *" })));
    await okForm(triggerNcmBackup(undefined, form({ switchId: "3" })));
    expect(mocks.updateNcmJob).toHaveBeenCalledWith(
      expect.anything(),
      9,
      expect.objectContaining({ schedule: "0 3 * * *" }),
    );
    expect(mocks.triggerNcmBackup).toHaveBeenCalledWith(expect.anything(), 3);
  });

  it("creates a baseline from a backup", async () => {
    const result = await createNcmBaseline(undefined, form({ backupId: "5" }));

    expect(result).toMatchObject({ success: true });
    expect(mocks.createNcmBaseline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ backup_id: 5 }),
    );
  });

  it("decides a review with a note and surfaces NCM errors as messages", async () => {
    const result = await decideNcmReview(
      undefined,
      form({ reviewId: "4", decision: "approve", note: "sesuai CR" }),
    );

    expect(result).toMatchObject({ success: true });
    expect(mocks.decideNcmReview).toHaveBeenCalledWith(
      expect.anything(),
      4,
      expect.objectContaining({ decision: "approve", note: "sesuai CR" }),
    );

    mocks.decideNcmReview.mockRejectedValueOnce(new Error("NCM API responded 403: forbidden"));
    const failed = await decideNcmReview(
      undefined,
      form({ reviewId: "4", decision: "reject", note: "salah port" }),
    );
    expect(failed).toMatchObject({ message: expect.stringContaining("403") });
  });

  it("loads a review detail for the diff view", async () => {
    const result = await getNcmReviewDetail(4);

    expect(result).toMatchObject({ id: 4, diff: "--- a\n+++ b" });
  });

  it("loads backup content for golden baseline inspection", async () => {
    const result = await getNcmBackupContent(10);

    expect(result).toMatchObject({ backupId: 10, content: "hostname SW-CORE-01" });
  });

  it("adds, updates, and deletes credentials", async () => {
    await okForm(
      addNcmCredential(
        undefined,
        form({ name: "cred-lab", username: "admin", password: "secret-password" }),
      ),
    );
    expect(mocks.createNcmCredential).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "cred-lab", username: "admin", password: "secret-password" }),
    );

    await okForm(
      updateNcmCredentialAction(
        undefined,
        form({ credId: "1", name: "cred-lab-v2", password: "new-password" }),
      ),
    );
    expect(mocks.updateNcmCredential).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.objectContaining({ name: "cred-lab-v2", password: "new-password" }),
    );

    await okForm(deleteNcmCredentialAction(undefined, form({ credId: "1" })));
    expect(mocks.deleteNcmCredential).toHaveBeenCalledWith(expect.anything(), 1);
  });
});
