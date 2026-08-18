
import "server-only";
import { cookies, headers } from "next/headers";
import { generateCsrfToken } from "./csrf-token";
import { validateSessionPayload } from "./session-auth";
import { decrypt, encrypt, type SessionRole } from "./session-token";
import { getEnv } from "./env";

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

    // secure: true only when the deployment is actually HTTPS — an explicit
    // SECURE_COOKIES=true override, an https APP_URL, or the request arriving
    // through a TLS proxy (X-Forwarded-Proto: https, e.g. NODE_ENV=production
    // behind a reverse proxy). Plain HTTP on LAN/on-prem deployments stays
    // non-secure so the session cookie can persist (finding #18); SECURE_COOKIES
    // defaults false to match the pre-#46 behavior unless one of the https
    // signals above is present.
    const env = getEnv();
    let proxiedHttps = false;
    try {
      proxiedHttps = (await headers()).get("x-forwarded-proto") === "https";
    } catch {
      // Not inside a request scope — fall back to the env-based decision.
    }
    const isSecure =
      env.SECURE_COOKIES === "true" ||
      String(env.APP_URL ?? "").trim().replace(/\/+$/, "").toLowerCase().startsWith("https://") ||
      proxiedHttps;

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
