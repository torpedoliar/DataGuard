// No "server-only" marker: imported transitively by lib/session.ts, which the
// tsx workers reach via lib/audit — a hard-throwing marker crash-loops them.
// Session validation is server-side by nature (db + fingerprint check).
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionFingerprint, type SessionPayload, type SessionRole } from "./session-token";

export type VerifiedSession = {
    isAuth: true;
    userId: number;
    username: string;
    role: SessionRole;
    activeSiteId: number | null;
    activeSiteName: string | null;
    passwordFingerprint: string;
};

/**
 * Validate the JWT claims against the current user record.
 *
 * The database lookup is deliberately fail-closed: a missing user, disabled
 * account, changed role/password, or database error produces no authenticated
 * session. This function is shared by server actions and Node middleware so a
 * revoked token cannot pass through only one of the two request boundaries.
 */
export async function validateSessionPayload(
    payload: SessionPayload,
): Promise<VerifiedSession | null> {
    try {
        const user = await db.query.users.findFirst({
            where: eq(users.id, payload.userId),
            columns: {
                id: true,
                username: true,
                role: true,
                isActive: true,
                passwordHash: true,
            },
        });

        if (!user || user.isActive !== true || user.role !== payload.role) {
            return null;
        }

        const currentFingerprint = await getSessionFingerprint(user.passwordHash);
        if (currentFingerprint !== payload.passwordFingerprint) {
            return null;
        }

        return {
            isAuth: true,
            userId: user.id,
            username: user.username,
            role: user.role,
            activeSiteId: payload.activeSiteId,
            activeSiteName: payload.activeSiteName,
            passwordFingerprint: payload.passwordFingerprint,
        };
    } catch {
        return null;
    }
}
