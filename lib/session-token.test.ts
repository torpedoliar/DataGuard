import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { getEnvValue } from "./env";
import { decrypt, encrypt, type SessionPayload } from "./session-token";

const validPayload: SessionPayload = {
    userId: 7,
    username: "alice",
    role: "staff",
    activeSiteId: null,
    activeSiteName: null,
    passwordFingerprint: "a".repeat(64),
    expiresAt: new Date("2026-08-22T00:00:00.000Z"),
};

describe("session token claims", () => {
    it("round-trips a token with the required password fingerprint", async () => {
        const token = await encrypt(validPayload);

        await expect(decrypt(token)).resolves.toMatchObject({
            userId: 7,
            role: "staff",
            passwordFingerprint: validPayload.passwordFingerprint,
        });
    });

    it("rejects a legacy signed token without passwordFingerprint", async () => {
        const secret = new TextEncoder().encode(getEnvValue("SESSION_SECRET"));
        const token = await new SignJWT({
            userId: 7,
            username: "alice",
            role: "staff",
            activeSiteId: null,
            activeSiteName: null,
            expiresAt: validPayload.expiresAt,
        })
            .setProtectedHeader({ alg: "HS256" })
            .setIssuedAt()
            .setExpirationTime("7d")
            .sign(secret);

        await expect(decrypt(token)).resolves.toBeNull();
    });
});
