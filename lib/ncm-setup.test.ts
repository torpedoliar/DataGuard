import { describe, expect, it } from "vitest";
import { generateWebhookSecret, requiredDgScopes, resolveIngestUrl } from "./ncm-setup";

describe("ncm-setup (ticket 13)", () => {
    it("generates a URL-safe secret of consistent length, unique per call", () => {
        const a = generateWebhookSecret();
        const b = generateWebhookSecret();
        expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(b).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(a).not.toBe(b);
    });

    it("derives the ingest URL from DG_PUBLIC_URL (or empty when unset)", () => {
        const prev = process.env.DG_PUBLIC_URL;
        process.env.DG_PUBLIC_URL = "https://dg.example.com/";
        expect(resolveIngestUrl()).toBe("https://dg.example.com/api/ncm/ingest");
        process.env.DG_PUBLIC_URL = "";
        expect(resolveIngestUrl()).toBe("");
        if (prev !== undefined) process.env.DG_PUBLIC_URL = prev;
    });

    it("lists the full scope set the DG client needs (incl system:write)", () => {
        const scopes = requiredDgScopes();
        expect(scopes).toContain("read");
        expect(scopes).toContain("system:write");
        expect(scopes).toContain("reviews:write");
        expect(scopes).toHaveLength(8);
    });
});
