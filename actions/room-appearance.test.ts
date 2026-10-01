import { beforeEach, describe, expect, it, vi } from "vitest";

const OLD = "/uploads/wallpapers/old.png";
const NEW = "/uploads/wallpapers/new.png";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  location: [] as unknown[],
  locked: null as string | null,
  updateSet: vi.fn(),
  failUpdate: false,
  saveUploadFile: vi.fn(),
  deleteUploadFile: vi.fn(),
}));

vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAdminAction: () => mocks.auth() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/upload", () => {
  class UploadValidationError extends Error {}
  return {
    UploadValidationError,
    saveUploadFile: (...a: unknown[]) => mocks.saveUploadFile(...a),
    deleteUploadFile: (...a: unknown[]) => mocks.deleteUploadFile(...a),
  };
});
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(mocks.location) }) }) }),
    transaction: async (fn: (tx: unknown) => unknown) => fn({
      select: () => ({ from: () => ({ where: () => ({ for: () => Promise.resolve([{ wallpaperPath: mocks.locked }]) }) }) }),
      update: () => ({
        set: (values: unknown) => {
          mocks.updateSet(values);
          return { where: () => (mocks.failUpdate ? Promise.reject(new Error("db down")) : Promise.resolve()) };
        },
      }),
    }),
  },
}));

import { updateRoomAppearance } from "./room-appearance";

const form = (fields: Record<string, string>, file?: File) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ lightColor: "#ffd9a8", lightBrightness: "1.2", wallpaper: "brick", wallpaperMode: "tile", ...fields })) fd.set(k, v);
  if (file) fd.set("wallpaperFile", file);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, session: {}, activeSiteId: 7 });
  mocks.location = [{ id: 3, name: "DC Room A", wallpaperPath: OLD }];
  mocks.locked = OLD;
  mocks.failUpdate = false;
  mocks.saveUploadFile.mockResolvedValue(null);
});

describe("updateRoomAppearance", () => {
  it("refuses non-admins", async () => {
    mocks.auth.mockResolvedValue({ ok: false, message: "Unauthorized. Active-site admin access required." });
    expect(await updateRoomAppearance(3, form({}))).toEqual({ success: false, message: "Unauthorized. Active-site admin access required." });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it("refuses a location outside the active site without uploading", async () => {
    mocks.location = [];
    const res = await updateRoomAppearance(3, form({ wallpaper: "custom" }, new File(["x"], "w.png")));
    expect(res.success).toBe(false);
    expect(mocks.saveUploadFile).not.toHaveBeenCalled();
  });

  it("rejects invalid settings", async () => {
    expect((await updateRoomAppearance(3, form({ lightColor: "blue" }))).success).toBe(false);
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it("switching to a built-in wallpaper clears and deletes the uploaded image", async () => {
    const res = await updateRoomAppearance(3, form({ wallpaper: "brick" }));
    expect(mocks.updateSet).toHaveBeenCalledWith({ lightColor: "#ffd9a8", lightBrightness: 1.2, wallpaper: "brick", wallpaperMode: "tile", wallpaperPath: null });
    expect(mocks.deleteUploadFile).toHaveBeenCalledWith(OLD);
    expect(res).toEqual({ success: true, appearance: { lightColor: "#ffd9a8", lightBrightness: 1.2, wallpaper: "brick", wallpaperPath: null, wallpaperMode: "tile" } });
  });

  it("a new custom image replaces the old one", async () => {
    mocks.saveUploadFile.mockResolvedValue(NEW);
    await updateRoomAppearance(3, form({ wallpaper: "custom", wallpaperMode: "stretch" }, new File(["x"], "w.png")));
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ wallpaper: "custom", wallpaperPath: NEW }));
    expect(mocks.deleteUploadFile).toHaveBeenCalledWith(OLD);
  });

  it("custom without a new file keeps the stored image", async () => {
    await updateRoomAppearance(3, form({ wallpaper: "custom" }));
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ wallpaperPath: OLD }));
    expect(mocks.deleteUploadFile).not.toHaveBeenCalled();
  });

  it("custom with no file and nothing stored is an error, nothing written", async () => {
    mocks.location = [{ id: 3, name: "DC Room A", wallpaperPath: null }];
    const res = await updateRoomAppearance(3, form({ wallpaper: "custom" }));
    expect(res).toEqual({ success: false, message: "Upload an image for a custom wallpaper." });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it("a failed save deletes the new upload and keeps the old one", async () => {
    mocks.saveUploadFile.mockResolvedValue(NEW);
    mocks.failUpdate = true;
    const res = await updateRoomAppearance(3, form({ wallpaper: "custom" }, new File(["x"], "w.png")));
    expect(res.success).toBe(false);
    expect(mocks.deleteUploadFile).toHaveBeenCalledWith(NEW);
    expect(mocks.deleteUploadFile).not.toHaveBeenCalledWith(OLD);
  });
});
