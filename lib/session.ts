
import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getEnvValue } from "./env";

const secretKey = getEnvValue("SESSION_SECRET");
const encodedKey = new TextEncoder().encode(secretKey);

export type SessionPayload = {
    userId: number;
    username: string;
    role: "superadmin" | "admin" | "staff";
    activeSiteId: number | null;
    activeSiteName: string | null;
    expiresAt: Date;
};

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
        return payload as unknown as SessionPayload;
    } catch (_error) {
        return null;
    }
}

export async function createSession(
    userId: number,
    username: string,
    role: "superadmin" | "admin" | "staff",
    activeSiteId: number | null = null,
    activeSiteName: string | null = null
) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const session = await encrypt({ userId, username, role, activeSiteId, activeSiteName, expiresAt });

    const cookieStore = await cookies();
    cookieStore.set("session", session, {
        httpOnly: true,
        secure: true,
        expires: expiresAt,
        sameSite: "lax",
        path: "/",
    });
}

export async function verifySession() {
    const cookieStore = await cookies();
    const session = cookieStore.get("session")?.value;
    const payload = await decrypt(session);

    if (!session || !payload) {
        return null;
    }

    return {
        isAuth: true,
        userId: payload.userId,
        username: payload.username,
        role: payload.role,
        activeSiteId: payload.activeSiteId,
        activeSiteName: payload.activeSiteName,
    };
}

export async function deleteSession() {
    const cookieStore = await cookies();
    cookieStore.delete("session");
}
