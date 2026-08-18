import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { getEnvValue } from "./env";

const secretKey = getEnvValue("SESSION_SECRET");
const encodedKey = new TextEncoder().encode(secretKey);

export const SESSION_ROLES = ["superadmin", "admin", "staff"] as const;
export type SessionRole = (typeof SESSION_ROLES)[number];

export type SessionPayload = {
    userId: number;
    username: string;
    role: SessionRole;
    activeSiteId: number | null;
    activeSiteName: string | null;
    passwordFingerprint: string;
    expiresAt: Date;
};

function isSessionPayload(payload: JWTPayload): payload is SessionPayload {
    const activeSiteId = payload.activeSiteId;
    const activeSiteName = payload.activeSiteName;
    const role = payload.role;
    const passwordFingerprint = payload.passwordFingerprint;

    return typeof payload.userId === "number"
        && Number.isInteger(payload.userId)
        && payload.userId > 0
        && typeof payload.username === "string"
        && payload.username.length > 0
        && typeof role === "string"
        && SESSION_ROLES.includes(role as SessionRole)
        && (activeSiteId === null || (typeof activeSiteId === "number" && Number.isInteger(activeSiteId)))
        && (activeSiteName === null || typeof activeSiteName === "string")
        && typeof passwordFingerprint === "string"
        && /^[0-9a-f]{64}$/.test(passwordFingerprint);
}

/**
 * Derive a non-reversible authenticator from the current password hash.
 * Password changes produce a new bcrypt hash, so old JWTs fail validation
 * without putting the password hash itself into the token.
 */
export async function getSessionFingerprint(passwordHash: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        encodedKey,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(passwordHash),
    );

    let hex = "";
    for (const byte of new Uint8Array(signature)) {
        hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
}

export async function encrypt(payload: SessionPayload) {
    return new SignJWT(payload)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("7d")
        .sign(encodedKey);
}

export async function decrypt(session: string | undefined = "") {
    try {
        const { payload } = await jwtVerify(session, encodedKey, {
            algorithms: ["HS256"],
        });

        // Reject tokens issued before passwordFingerprint was required.
        // Signature validity alone is not enough to establish a current session.
        if (!isSessionPayload(payload)) {
            return null;
        }

        return payload;
    } catch {
        return null;
    }
}
