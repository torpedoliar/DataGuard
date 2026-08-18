import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteUploadFile,
  detectUploadType,
  getUploadRoot,
  saveUploadFile,
  UploadValidationError,
  validateUpload,
} from "./upload";

const PNG_BYTES = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
];
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0];
const GIF_BYTES = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

function makeFile(bytes: number[], name = "photo.png", type = "image/png"): File {
  return new File([Uint8Array.from(bytes)], name, { type });
}

const createdPaths: string[] = [];

afterEach(async () => {
  await Promise.all(createdPaths.splice(0).map((filePath) => fs.rm(filePath, { force: true })));
});

describe("upload validation", () => {
  it("detects supported formats from magic bytes rather than MIME metadata", () => {
    expect(detectUploadType(Uint8Array.from(PNG_BYTES))).toBe("png");
    expect(detectUploadType(Uint8Array.from(JPEG_BYTES))).toBe("jpeg");
    expect(detectUploadType(Uint8Array.from(GIF_BYTES))).toBe("gif");
    expect(detectUploadType(Uint8Array.from([0x00, 0x00, 0x01, 0x00]))).toBe("ico");
    expect(detectUploadType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it("rejects SVG and content spoofing even when the client MIME says image", async () => {
    const svg = makeFile(
      Array.from(new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")),
      "logo.png",
      "image/png",
    );

    await expect(validateUpload(svg, { kind: "logo" })).rejects.toMatchObject({
      code: "INVALID_CONTENT",
    });
  });

  it("rejects a logo format that is not in the logo allowlist", async () => {
    await expect(validateUpload(makeFile(GIF_BYTES, "logo.gif", "image/gif"), { kind: "logo" })).rejects.toMatchObject({
      code: "UNSUPPORTED_TYPE",
      detectedType: "gif",
    });
  });

  it("checks the declared size before reading the file body", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(1));
    const oversized = {
      name: "large.png",
      size: 6,
      arrayBuffer,
    } as unknown as File;

    await expect(saveUploadFile(oversized, "test", { maxBytes: 5 })).rejects.toMatchObject({
      code: "TOO_LARGE",
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("enforces the configured MAX_FILE_SIZE env default (not just the per-call override)", async () => {
    // #47 regression: MAX_FILE_SIZE is consumed via getEnv() when no per-call
    // `maxBytes` is given. Reset modules so a fresh env module parses the
    // new value, mirroring lib/env.test.ts.
    vi.resetModules();
    process.env.MAX_FILE_SIZE = "10";
    const mod = await import("./upload");

    const arrayBuffer = vi.fn(async () => new ArrayBuffer(1));
    const oversized = {
      name: "big.png",
      size: 11,
      arrayBuffer,
    } as unknown as File;

    try {
      await expect(mod.saveUploadFile(oversized, "test")).rejects.toMatchObject({
        code: "TOO_LARGE",
      });
      expect(arrayBuffer).not.toHaveBeenCalled();
    } finally {
      delete process.env.MAX_FILE_SIZE;
    }
  });

  it("writes canonical extensions and keeps the generated path inside the selected directory", async () => {
    const uploadPath = await saveUploadFile(
      makeFile(PNG_BYTES, "../../not-used.svg", "image/svg+xml"),
      "device/../../unsafe",
      { directory: "devices", kind: "photo" },
    );

    expect(uploadPath).toMatch(/^\/uploads\/devices\/device_+unsafe-[0-9a-f-]+\.png$/);
    const filePath = path.join(process.cwd(), "public", uploadPath!.slice(1).replaceAll("/", path.sep));
    createdPaths.push(filePath);
    await expect(fs.readFile(filePath)).resolves.toEqual(Buffer.from(PNG_BYTES));
  });

  it("refuses to delete paths outside the upload root", async () => {
    const outsidePath = path.join(process.cwd(), "public", "upload-security-test-marker.txt");
    await fs.writeFile(outsidePath, "marker");
    createdPaths.push(outsidePath);

    await expect(deleteUploadFile("/uploads/../upload-security-test-marker.txt")).resolves.toBe(false);
    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("marker");
    expect(getUploadRoot()).toBe(path.resolve(process.cwd(), "public", "uploads"));
  });

  it("exposes a typed validation error for callers that need to preserve action contracts", async () => {
    try {
      await validateUpload(makeFile([0x01, 0x02], "bad.bin", "application/octet-stream"));
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(UploadValidationError);
      expect((error as UploadValidationError).code).toBe("INVALID_CONTENT");
    }
  });
});
