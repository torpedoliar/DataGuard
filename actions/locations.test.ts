import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  existing: [] as unknown[],
  updateSet: vi.fn(),
  saveUploadFile: vi.fn(),
  deleteUploadFile: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ verifySession: () => mocks.verifySession() }));
vi.mock("@/lib/audit", () => ({ logAudit: (...args: unknown[]) => mocks.logAudit(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/upload", () => {
  class UploadValidationError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    UploadValidationError,
    saveUploadFile: (...args: unknown[]) => mocks.saveUploadFile(...args),
    deleteUploadFile: (...args: unknown[]) => mocks.deleteUploadFile(...args),
  };
});
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(mocks.existing) }) }) }),
    update: () => ({
      set: (values: unknown) => {
        mocks.updateSet(values);
        return { where: () => Promise.resolve() };
      },
    }),
  },
}));

import { UploadValidationError } from "@/lib/upload";
import { updateLocation } from "./locations";

const OLD = "/uploads/floorplans/floorplan-3-old.png";
const NEW = "/uploads/floorplans/floorplan-3-new.png";

function form(extra: Record<string, string | File> = {}) {
  const fd = new FormData();
  fd.set("id", "3");
  fd.set("name", "DC Room");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

const png = () => new File([new Uint8Array([1, 2, 3])], "plan.png", { type: "image/png" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifySession.mockResolvedValue({ role: "admin", activeSiteId: 7 });
  mocks.existing = [{ id: 3, name: "DC Room", tempThresholdC: 27, floorPlanPath: OLD }];
  mocks.saveUploadFile.mockResolvedValue(null);
  mocks.deleteUploadFile.mockResolvedValue(true);
});

describe("updateLocation floor plan", () => {
  it("stores a new plan and deletes the replaced file after the update", async () => {
    mocks.saveUploadFile.mockResolvedValue(NEW);

    const result = await updateLocation(null, form({ floorPlan: png() }));

    expect(result).toMatchObject({ success: true });
    expect(mocks.saveUploadFile).toHaveBeenCalledWith(expect.anything(), "floorplan-3", { kind: "logo", directory: "floorplans" });
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ floorPlanPath: NEW }));
    expect(mocks.deleteUploadFile).toHaveBeenCalledWith(OLD);
  });

  it("clears the plan and deletes the file when removeFloorPlan is checked", async () => {
    await updateLocation(null, form({ removeFloorPlan: "on" }));

    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ floorPlanPath: null }));
    expect(mocks.deleteUploadFile).toHaveBeenCalledWith(OLD);
  });

  it("keeps the stored plan when neither a file nor the remove flag is sent", async () => {
    await updateLocation(null, form());

    const set = mocks.updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(set.floorPlanPath).toBeUndefined();
    expect(mocks.deleteUploadFile).not.toHaveBeenCalled();
  });

  it("returns the validation message and does not update on a bad file", async () => {
    mocks.saveUploadFile.mockRejectedValue(new UploadValidationError("UNSUPPORTED_TYPE", "Unsupported image format."));

    const result = await updateLocation(null, form({ floorPlan: png() }));

    expect(result).toEqual({ success: false, message: "Unsupported image format." });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it("deletes the freshly saved file when the DB update fails", async () => {
    mocks.saveUploadFile.mockResolvedValue(NEW);
    mocks.updateSet.mockImplementation(() => { throw new Error("db down"); });

    const result = await updateLocation(null, form({ floorPlan: png() }));

    expect(result).toEqual({ success: false, message: "Failed to update location" });
    expect(mocks.deleteUploadFile).toHaveBeenCalledWith(NEW);
    expect(mocks.deleteUploadFile).not.toHaveBeenCalledWith(OLD);
  });
});
