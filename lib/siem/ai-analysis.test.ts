import { describe, expect, it } from "vitest";
import { buildSiemAiPrompt, extractFirstJsonObject, normalizeOpenAiCompatibleEndpoint, normalizeSiemAiAnalysis, requestSiemAiAnalysis } from "./ai-analysis";

describe("SIEM AI analysis", () => {
  it("normalizes OpenAI-compatible chat completion endpoints", () => {
    expect(normalizeOpenAiCompatibleEndpoint("https://api.9router.example/v1")).toBe("https://api.9router.example/v1/chat/completions");
    expect(normalizeOpenAiCompatibleEndpoint("https://api.9router.example/v1/chat/completions")).toBe("https://api.9router.example/v1/chat/completions");
    expect(normalizeOpenAiCompatibleEndpoint(" ")).toBeNull();
  });

  it("omits the Authorization header when no api key is provided", async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetchFn = (async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    await requestSiemAiAnalysis({ endpointUrl: "https://router.local/v1/chat/completions", model: "m", prompt: "p", fetchFn });

    expect(capturedHeaders.Authorization).toBeUndefined();
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
  });

  it("sends a Bearer Authorization header when an api key is provided", async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetchFn = (async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    await requestSiemAiAnalysis({ endpointUrl: "https://router.local/v1/chat/completions", apiKey: "sk-123", model: "m", prompt: "p", fetchFn });

    expect(capturedHeaders.Authorization).toBe("Bearer sk-123");
  });

  it("parses clean JSON content", () => {
    expect(extractFirstJsonObject('{"summary":"ok"}')).toEqual({ summary: "ok" });
  });

  it("parses JSON wrapped in markdown fences", () => {
    expect(extractFirstJsonObject('```json\n{"summary":"ok"}\n```')).toEqual({ summary: "ok" });
  });

  it("parses JSON followed by trailing reasoning text", () => {
    const content = '{"summary":"ok","evidence":["a"]}\n\nThe above explains the finding.';
    expect(extractFirstJsonObject(content)).toEqual({ summary: "ok", evidence: ["a"] });
  });

  it("ignores braces inside string values when extracting", () => {
    const content = '{"summary":"contains } brace"}trailing';
    expect(extractFirstJsonObject(content)).toEqual({ summary: "contains } brace" });
  });

  it("throws when no JSON object is present", () => {
    expect(() => extractFirstJsonObject("no json here")).toThrow();
  });

  it("extracts JSON from provider content via requestSiemAiAnalysis", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: '```json\n{"summary":"hi"}\n```\nextra reasoning' } }] }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const result = await requestSiemAiAnalysis({ endpointUrl: "https://router.local/v1/chat/completions", model: "m", prompt: "p", fetchFn });
    expect(result).toEqual({ summary: "hi" });
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
