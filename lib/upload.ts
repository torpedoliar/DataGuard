import "server-only";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getEnv } from "./env";

const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024;
const UPLOAD_URL_PREFIX = "/uploads/";

export type UploadKind = "photo" | "logo" | "favicon";
export type UploadDirectory = "root" | "devices" | "brands" | "settings" | "profiles" | "threat-intel";
export type UploadValidationCode = "TOO_LARGE" | "UNSUPPORTED_TYPE" | "INVALID_CONTENT";
export type DetectedUploadType = keyof typeof UPLOAD_TYPES;

export type UploadOptions = {
  kind?: UploadKind;
  directory?: UploadDirectory;
  maxBytes?: number;
};

export type ValidatedUpload = {
  buffer: Buffer;
  type: DetectedUploadType;
  mimeType: string;
  extension: string;
  size: number;
};

const UPLOAD_TYPES = {
  jpeg: { mimeType: "image/jpeg", extension: "jpg" },
  png: { mimeType: "image/png", extension: "png" },
  webp: { mimeType: "image/webp", extension: "webp" },
  gif: { mimeType: "image/gif", extension: "gif" },
  ico: { mimeType: "image/x-icon", extension: "ico" },
} as const;

const ALLOWED_TYPES: Record<UploadKind, readonly DetectedUploadType[]> = {
  // GIF remains available for evidence/profile photos; it is still identified
  // from bytes and is never accepted merely because the client says image/gif.
  photo: ["jpeg", "png", "webp", "gif"],
  logo: ["jpeg", "png", "webp"],
  favicon: ["png", "ico"],
};

const UPLOAD_DIRECTORIES: Record<UploadDirectory, string> = {
  root: "",
  devices: "devices",
  brands: "brands",
  settings: "settings",
  profiles: "profiles",
  "threat-intel": "threat-intel",
};

export class UploadValidationError extends Error {
  readonly code: UploadValidationCode;
  readonly detectedType: DetectedUploadType | null;

  constructor(
    code: UploadValidationCode,
    message: string,
    detectedType: DetectedUploadType | null = null,
  ) {
    super(message);
    this.name = "UploadValidationError";
    this.code = code;
    this.detectedType = detectedType;
  }
}

export function getUploadRoot(): string {
  return path.resolve(process.cwd(), "public", "uploads");
}

export function getUploadMimeType(type: DetectedUploadType): string {
  return UPLOAD_TYPES[type].mimeType;
}

export function getUploadExtension(type: DetectedUploadType): string {
  return UPLOAD_TYPES[type].extension;
}

function hasSignature(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function hasAscii(bytes: Uint8Array, value: string, offset = 0): boolean {
  return hasSignature(bytes, Array.from(value, (character) => character.charCodeAt(0)), offset);
}

/** Detect a file type from its bytes. Client MIME and filename are not used. */
export function detectUploadType(bytes: Uint8Array): DetectedUploadType | null {
  if (bytes.length >= 3 && hasSignature(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (bytes.length >= 8 && hasSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (bytes.length >= 12 && hasAscii(bytes, "RIFF") && hasAscii(bytes, "WEBP", 8)) return "webp";
  if (bytes.length >= 6 && (hasAscii(bytes, "GIF87a") || hasAscii(bytes, "GIF89a"))) return "gif";
  if (bytes.length >= 4 && hasSignature(bytes, [0x00, 0x00, 0x01, 0x00])) return "ico";
  return null;
}

function getMaxBytes(options: UploadOptions): number {
  const configured = options.maxBytes ?? getEnv().MAX_FILE_SIZE ?? DEFAULT_MAX_FILE_SIZE;
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_MAX_FILE_SIZE;
  return Math.floor(configured);
}

function formatMaxBytes(maxBytes: number): string {
  const megabytes = maxBytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}

function isFileLike(value: File | null | undefined): value is File {
  return Boolean(
    value
      && typeof value.size === "number"
      && typeof value.arrayBuffer === "function",
  );
}

/** Validate an optional upload and return canonical bytes/type metadata. */
export async function validateUpload(
  file: File | null | undefined,
  options: UploadOptions = {},
): Promise<ValidatedUpload | null> {
  if (!isFileLike(file) || file.name === "undefined" || file.size === 0) return null;

  const maxBytes = getMaxBytes(options);
  // Check the advertised File size before reading any bytes into memory.
  if (file.size > maxBytes) {
    throw new UploadValidationError(
      "TOO_LARGE",
      `File is too large. The maximum upload size is ${formatMaxBytes(maxBytes)}.`,
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new UploadValidationError(
      "TOO_LARGE",
      `File is too large. The maximum upload size is ${formatMaxBytes(maxBytes)}.`,
    );
  }

  const detectedType = detectUploadType(buffer);
  if (!detectedType) {
    throw new UploadValidationError(
      "INVALID_CONTENT",
      "The uploaded file is not a supported image.",
    );
  }

  const kind = options.kind ?? "photo";
  if (!ALLOWED_TYPES[kind].includes(detectedType)) {
    const allowed = ALLOWED_TYPES[kind]
      .map((type) => `.${getUploadExtension(type)}`)
      .join(", ");
    throw new UploadValidationError(
      "UNSUPPORTED_TYPE",
      `Unsupported image format. Allowed formats: ${allowed}.`,
      detectedType,
    );
  }

  return {
    buffer,
    type: detectedType,
    mimeType: getUploadMimeType(detectedType),
    extension: getUploadExtension(detectedType),
    size: buffer.length,
  };
}

function isWithinUploadRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safePrefix(prefix: string): string {
  const normalized = prefix.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "upload";
}

function resolveUploadPath(relativeSegments: string[]): string {
  const root = getUploadRoot();
  const candidate = path.resolve(root, ...relativeSegments);
  if (!isWithinUploadRoot(root, candidate)) {
    throw new Error("Resolved upload path is outside the upload directory.");
  }
  return candidate;
}

/** Save a validated upload while preserving the existing public URL layout. */
export async function saveUploadFile(
  file: File | null | undefined,
  prefix: string,
  options: UploadOptions = {},
): Promise<string | null> {
  const validated = await validateUpload(file, options);
  if (!validated) return null;

  const directory = options.directory ?? "root";
  const relativeDirectory = UPLOAD_DIRECTORIES[directory];
  const uploadDirectory = resolveUploadPath(relativeDirectory ? [relativeDirectory] : []);
  await fs.mkdir(uploadDirectory, { recursive: true });

  const filename = `${safePrefix(prefix)}-${crypto.randomUUID()}.${validated.extension}`;
  const filePath = resolveUploadPath(relativeDirectory ? [relativeDirectory, filename] : [filename]);
  await fs.writeFile(filePath, validated.buffer, { flag: "wx" });

  return `${UPLOAD_URL_PREFIX}${relativeDirectory ? `${relativeDirectory}/` : ""}${filename}`;
}

/** Resolve only paths previously stored under the public upload URL prefix. */
export function resolveStoredUploadPath(uploadPath: string | null | undefined): string | null {
  if (!uploadPath || !uploadPath.startsWith(UPLOAD_URL_PREFIX) || uploadPath.includes("\0")) {
    return null;
  }

  const relativePath = uploadPath.slice(UPLOAD_URL_PREFIX.length);
  const segments = relativePath.split("/");
  if (
    segments.length === 0
    || segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))
  ) {
    return null;
  }

  const root = getUploadRoot();
  const candidate = path.resolve(root, ...segments);
  return isWithinUploadRoot(root, candidate) ? candidate : null;
}

/** Delete a stored upload only when its URL resolves inside the upload root. */
export async function deleteUploadFile(uploadPath: string | null | undefined): Promise<boolean> {
  const filePath = resolveStoredUploadPath(uploadPath);
  if (!filePath) return false;

  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
