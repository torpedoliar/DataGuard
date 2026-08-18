
import "server-only";
import { cookies } from "next/headers";
import { generateCsrfToken } from "./csrf-token";
import { validateSessionPayload } from "./session-auth";
import { decrypt, encrypt, type SessionRole } from "./session-token";

export { decrypt, encrypt } from "./session-token";
export type { SessionPayload, SessionRole } from "./session-token";

export async function createSession(
    userId: number,
    username: string,
    role: SessionRole,
    activeSiteId: number | null = null,
    activeSiteName: string | null = null,
    passwordFingerprint = "",
) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const session = await encrypt({
        userId,
        username,
        role,
        activeSiteId,
        activeSiteName,
        passwordFingerprint,
        expiresAt,
    });

    // secure: true hanya jika diakses via HTTPS (misal di belakang reverse proxy)
    // Jika masih HTTP (akses langsung via IP), harus false agar cookie bisa tersimpan
    const isSecure = process.env.SECURE_COOKIES === "true";

    const cookieStore = await cookies();
    cookieStore.set("session", session, {
        httpOnly: true,
        secure: isSecure,
        expires: expiresAt,
        sameSite: "lax",
        path: "/",
    });

    // CSRF double-submit token. Non-httpOnly so the client can read it
    // and echo it back in the X-CSRF-Token header. Lax allows top-level
    // navigation; the server compares header to cookie via timingSafeEqual.
    cookieStore.set("csrf", generateCsrfToken(), {
        httpOnly: false,
        secure: isSecure,
        expires: expiresAt,
        sameSite: "lax",
        path: "/",
    });
}

export async function verifySession() {
    const cookieStore = await cookies();
    const session = cookieStore.get("session")?.value;
    const payload = await decrypt(session);

    if (!payload) {
        return null;
    }

    return validateSessionPayload(payload);
}

export async function deleteSession() {
    const cookieStore = await cookies();
    cookieStore.delete("session");
    cookieStore.delete("csrf");
}
