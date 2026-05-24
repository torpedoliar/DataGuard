import { describe, expect, it } from "vitest";
import { buildSiemAiPrompt, normalizeOpenAiCompatibleEndpoint, normalizeSiemAiAnalysis, resolveSiemAiModel } from "./ai-analysis";

describe("SIEM AI analysis", () => {
  it("normalizes OpenAI-compatible chat completion endpoints", () => {
    expect(normalizeOpenAiCompatibleEndpoint("https://api.9router.example/v1")).toBe("https://api.9router.example/v1/chat/completions");
    expect(normalizeOpenAiCompatibleEndpoint("https://api.9router.example/v1/chat/completions")).toBe("https://api.9router.example/v1/chat/completions");
    expect(normalizeOpenAiCompatibleEndpoint(" ")).toBeNull();
  });

  it("resolves default model with fallback order", () => {
    expect(resolveSiemAiModel({ aiDefaultModel: "manual", aiModelOpus: "opus", aiModelSonnet: "sonnet", aiModelHaiku: "haiku" })).toBe("manual");
    expect(resolveSiemAiModel({ aiDefaultModel: null, aiModelOpus: "opus", aiModelSonnet: "sonnet", aiModelHaiku: "haiku" })).toBe("sonnet");
    expect(resolveSiemAiModel({ aiDefaultModel: null, aiModelOpus: null, aiModelSonnet: null, aiModelHaiku: null })).toBeNull();
  });

  it("builds redacted evidence-only prompts", () => {
    const prompt = buildSiemAiPrompt({
      maxRawLength: 2000,
      finding: {
        id: 1,
        title: "Failed login spike",
        severity: "High",
        status: "Open",
        summary: "token=abc123 login failed",
        humanAnalysis: null,
        recommendedAction: null,
        eventCount: 2,
        correlationKey: "auth.failed|srcIp:10.0.0.5",
        sourceIp: "10.0.0.5",
        deviceName: "Router",
        ruleName: "Failed login spike",
        ruleDescription: "Many failed logins",
      },
      events: [{
        id: 9,
        receivedAt: new Date("2026-05-24T12:00:00.000Z"),
        category: "Authentication",
        normalizedType: "auth_failure",
        action: "login",
        outcome: "failure",
        username: "admin",
        srcIp: "10.0.0.5",
        dstIp: null,
        message: "password=secret token=abc123",
        rawMessage: "authorization: Bearer xyz",
      }],
    });

    expect(prompt).toContain("Use only evidence");
    expect(prompt).toContain("password=[REDACTED]");
    expect(prompt).not.toContain("secret");
    expect(prompt).not.toContain("abc123");
    expect(prompt).not.toContain("xyz");
  });

  it("normalizes provider JSON into stored analysis", () => {
    const analysis = normalizeSiemAiAnalysis({ summary: "A", likelyCause: "B", impact: "C", recommendedActions: ["D"], evidence: ["E"] }, "model-x", new Date("2026-05-24T12:00:00.000Z"));

    expect(analysis).toEqual({
      generatedAt: "2026-05-24T12:00:00.000Z",
      model: "model-x",
      summary: "A",
      likelyCause: "B",
      impact: "C",
      recommendedActions: ["D"],
      evidence: ["E"],
    });
  });
});
