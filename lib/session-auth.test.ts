import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstUser = vi.fn();

vi.mock("@/db", () => ({
    db: {
        query: {
            users: {
                findFirst: (...args: unknown[]) => findFirstUser(...args),
            },
        },
    },
}));

import { getSessionFingerprint, type SessionPayload } from "./session-token";
import { validateSessionPayload } from "./session-auth";

const passwordHash = "bcrypt-hash-v1";
const payload: SessionPayload = {
    userId: 7,
    username: "alice",
    role: "staff",
    activeSiteId: 3,
    activeSiteName: "DC-JKT",
    passwordFingerprint: "pending",
    expiresAt: new Date("2026-08-22T00:00:00.000Z"),
};

beforeEach(async () => {
    findFirstUser.mockReset();
    payload.passwordFingerprint = await getSessionFingerprint(passwordHash);
});

describe("validateSessionPayload", () => {
    it("accepts an active user whose role and password hash match", async () => {
        findFirstUser.mockResolvedValueOnce({
            id: 7,
            username: "alice",
            role: "staff",
            isActive: true,
            passwordHash,
        });

        await expect(validateSessionPayload(payload)).resolves.toMatchObject({
            isAuth: true,
            userId: 7,
            role: "staff",
            activeSiteId: 3,
            passwordFingerprint: payload.passwordFingerprint,
        });
    });

    it.each([
        ["missing", undefined],
        ["inactive", { id: 7, username: "alice", role: "staff", isActive: false, passwordHash }],
        ["role changed", { id: 7, username: "alice", role: "admin", isActive: true, passwordHash }],
        ["password changed", { id: 7, username: "alice", role: "staff", isActive: true, passwordHash: "bcrypt-hash-v2" }],
    ])("rejects a %s user state", async (_label, user) => {
        findFirstUser.mockResolvedValueOnce(user);

        await expect(validateSessionPayload(payload)).resolves.toBeNull();
    });

    it("fails closed when the user lookup errors", async () => {
        findFirstUser.mockRejectedValueOnce(new Error("database unavailable"));

        await expect(validateSessionPayload(payload)).resolves.toBeNull();
    });
});
