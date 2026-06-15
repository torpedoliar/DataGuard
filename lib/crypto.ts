/**
 * AES-256-GCM symmetric encryption for short strings (API keys, tokens, etc.).
 *
 * Wire format: `v1:<iv_b64u>.<ciphertext_b64u>.<tag_b64u>`
 * - v1 = algorithm version (lets us rotate later without breaking stored rows)
 * - iv = 12 random bytes, fresh per encryption (never reuse, never fixed)
 * - ciphertext = AES-256-GCM(plaintext, key, iv)
 * - tag = 16-byte GCM auth tag
 *
 * The encryption key is derived from `AI_KEY_ENCRYPTION_SECRET`. The secret may
 * be supplied as 32 raw bytes, 32+ ASCII characters, or hex/base64 encoded.
 * See {@link deriveKey} for the accepted formats.
 *
 * Server-only. Do not import from client components.
 */
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION_PREFIX = "v1:";

class CryptoError extends Error {
  override readonly name = "CryptoError";
}

function getSecret(): string {
  const secret = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!secret || secret.length === 0) {
    throw new CryptoError(
      "AI_KEY_ENCRYPTION_SECRET is not set. " +
        "Generate one with `openssl rand -base64 32` and add it to .env.production.",
    );
  }
  return secret;
}

/**
 * Derive a 32-byte key from the user-supplied secret. Accepts any of:
 *  - 64 hex characters (decoded as 32 bytes)
 *  - 32+ ASCII characters (hashed with SHA-256 to 32 bytes)
 *  - base64 of 32 raw bytes (decoded to 32 bytes)
 * The decoded length must be 32 bytes. Anything else throws — we never
 * silently truncate because a weak key would still "work" but provide
 * effectively no confidentiality.
 */
function deriveKey(secret: string): Buffer {
  // Hex (64 chars -> 32 bytes)
  if (/^[0-9a-fA-F]+$/.test(secret) && secret.length === 64) {
    return Buffer.from(secret, "hex");
  }
  // base64: try strict decode; if it yields 32 bytes, accept it
  if (secret.length % 4 === 0 && /^[A-Za-z0-9+/]+=*$/.test(secret)) {
    try {
      const buf = Buffer.from(secret, "base64");
      if (buf.length === 32) return buf;
    } catch {
      // fall through
    }
  }
  // Fallback: SHA-256 the secret so any length >= 32 still yields a 32-byte key.
  if (secret.length >= 32) {
    return createHash("sha256").update(secret, "utf8").digest();
  }
  throw new CryptoError(
    "AI_KEY_ENCRYPTION_SECRET must be at least 32 characters. " +
      "Generate one with `openssl rand -base64 32`.",
  );
}

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromBase64Url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function isBase64Url(s: string): boolean {
  // Empty string is allowed only as a valid "no bytes" encoding; the
  // base64url alphabet doesn't include the empty string so accept explicitly.
  if (s === "") return true;
  return /^[A-Za-z0-9_-]+$/.test(s);
}

/**
 * Encrypts a short string with AES-256-GCM. Returns a self-describing
 * envelope that can be stored as text and passed to {@link decryptString}.
 */
export function encryptString(plaintext: string): string {
  const key = deriveKey(getSecret());
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION_PREFIX}${toBase64Url(iv)}.${toBase64Url(ct)}.${toBase64Url(tag)}`;
}

/**
 * Decrypts an envelope produced by {@link encryptString}. Throws when the
 * envelope is malformed, the version is unknown, or the auth tag does not
 * verify (wrong key or tampered ciphertext).
 */
export function decryptString(ciphertext: string): string {
  if (typeof ciphertext !== "string" || !ciphertext.startsWith(VERSION_PREFIX)) {
    throw new CryptoError("Ciphertext is not in the v1: envelope format.");
  }
  const body = ciphertext.slice(VERSION_PREFIX.length);
  const parts = body.split(".");
  if (parts.length !== 3) {
    throw new CryptoError("Ciphertext envelope must have exactly three parts.");
  }
  // Allow empty ciphertext (e.g. when the plaintext is "") but each part
  // must still be valid base64url. The auth tag check below catches tampering.
  if (!isBase64Url(parts[0]!) || !isBase64Url(parts[1]!) || !isBase64Url(parts[2]!)) {
    throw new CryptoError("Ciphertext envelope parts are not valid base64url.");
  }
  const ivPart = parts[0]!;
  const ctPart = parts[1]!;
  const tagPart = parts[2]!;
  const iv = fromBase64Url(ivPart);
  const ct = fromBase64Url(ctPart);
  const tag = fromBase64Url(tagPart);
  if (iv.length !== IV_BYTES) {
    throw new CryptoError(`IV must be ${IV_BYTES} bytes, got ${iv.length}.`);
  }
  if (tag.length !== TAG_BYTES) {
    throw new CryptoError(`Auth tag must be ${TAG_BYTES} bytes, got ${tag.length}.`);
  }
  const key = deriveKey(getSecret());
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  } catch (err) {
    throw new CryptoError(
      `Decryption failed: ${err instanceof Error ? err.message : "unknown error"}. ` +
        "The ciphertext may be tampered with or the encryption key may have changed.",
    );
  }
}

/**
 * Cheap structural check: returns true if the value parses as the v1
 * envelope shape (version + 3 base64url parts). Does NOT verify the auth tag
 * — call {@link decryptString} for that.
 */
export function isEncryptedString(value: string): boolean {
  if (typeof value !== "string" || !value.startsWith(VERSION_PREFIX)) return false;
  const body = value.slice(VERSION_PREFIX.length);
  const parts = body.split(".");
  if (parts.length !== 3) return false;
  // Allow empty ciphertext (plaintext was "") but every part must be
  // base64url-shaped. The auth tag is verified by decryptString, not here.
  for (const part of parts) {
    if (!isBase64Url(part)) return false;
  }
  return true;
}

/**
 * Best-effort decrypt: returns the plaintext when `value` is in the v1
 * envelope, or returns `value` unchanged when it looks like plaintext. This
 * is the helper to use at read sites that need to handle legacy plaintext
 * rows from before encryption was rolled out.
 */
export function decryptIfEncrypted(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!isEncryptedString(value)) return value;
  return decryptString(value);
}
