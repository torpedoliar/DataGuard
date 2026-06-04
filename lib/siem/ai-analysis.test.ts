import { describe, expect, it } from "vitest";
import { buildSiemAiPrompt, extractFirstJsonObject, normalizeOpenAiCompatibleEndpoint, normalizeSiemAiAnalysis, parseChatCompletionBody, requestSiemAiAnalysis } from "./ai-analysis";

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

  it("parses an SSE envelope with a completion object and a [DONE] trailer", async () => {
    // Reproduces production: provider returns Content-Type text/event-stream for
    // large responses, body = {full chat.completion json}data: [DONE]\n\n
    const completion = JSON.stringify({ choices: [{ message: { content: '{"summary":"sse-ok"}' } }] });
    const body = `${completion}data: [DONE]\n\n`;
    const fetchFn = (async () =>
      new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;

    const result = await requestSiemAiAnalysis({ endpointUrl: "https://router.local/v1/chat/completions", model: "m", prompt: "p", fetchFn });
    expect(result).toEqual({ summary: "sse-ok" });
  });

  it("parses a true multi-chunk SSE stream by reassembling delta content", async () => {
    const chunk = (delta: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`;
    const body = chunk('{"sum') + chunk('mary":') + chunk('"streamed"}') + "data: [DONE]\n\n";
    const fetchFn = (async () =>
      new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;

    const result = await requestSiemAiAnalysis({ endpointUrl: "https://router.local/v1/chat/completions", model: "m", prompt: "p", fetchFn });
    expect(result).toEqual({ summary: "streamed" });
  });

  it("parseChatCompletionBody reads non-streaming JSON", () => {
    const body = JSON.stringify({ choices: [{ message: { content: "hello" } }] });
    expect(parseChatCompletionBody(body)).toBe("hello");
  });

  it("parseChatCompletionBody reads a completion object with a [DONE] trailer", () => {
    const body = JSON.stringify({ choices: [{ message: { content: "hi" } }] }) + "data: [DONE]\n\n";
    expect(parseChatCompletionBody(body)).toBe("hi");
  });

  it("parseChatCompletionBody reassembles streamed deltas", () => {
    const d = (c: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`;
    expect(parseChatCompletionBody(d("a") + d("b") + d("c") + "data: [DONE]\n\n")).toBe("abc");
  });

  it("parseChatCompletionBody throws on empty body", () => {
    expect(() => parseChatCompletionBody("   ")).toThrow();
  });

  it("sends a minimal body with no temperature or response_format (gateway error-caches those)", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      bodies.push(body);
      // A gateway that error-caches a `temperature` 400 would never recover via
      // retry; assert we never send the offending params in the first place.
      if ("temperature" in body || "response_format" in body) {
        return new Response(
          JSON.stringify({ error: { message: "[claude/claude-opus-4-8] [400]: `temperature` is deprecated for this model." } }),
          { status: 400 },
        );
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"opus-ok"}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await requestSiemAiAnalysis({ endpointUrl: "https://router.local/v1/chat/completions", model: "claude-opus-4-8", prompt: "p", fetchFn });
    expect(result).toEqual({ summary: "opus-ok" });
    // Exactly one request, minimal shape — no retry loop.
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty("temperature");
    expect(bodies[0]).not.toHaveProperty("response_format");
    expect(bodies[0]).toMatchObject({ model: "claude-opus-4-8", stream: false });
  });

  it("surfaces a 400 from the provider without retrying", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 400 });
    }) as unknown as typeof fetch;

    await expect(
      requestSiemAiAnalysis({ endpointUrl: "https://router.local/v1/chat/completions", model: "bogus", prompt: "p", fetchFn }),
    ).rejects.toThrow(/HTTP 400/);
    expect(calls).toBe(1);
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
    // No raw IP, device identity, or correlationKey leaks IP/host.
    expect(prompt).not.toContain("10.0.0.5");
    expect(prompt).not.toContain("Router");
    expect(prompt).not.toContain("deviceName");
    expect(prompt).not.toContain("correlationKey");
    expect(prompt).not.toContain("srcIp");
    // Username is PII -> masked to a token, raw name absent.
    expect(prompt).not.toContain("admin");
    expect(prompt).not.toContain("username");
    expect(prompt).toContain("USER_A");
    // IPs are replaced by stable masked tokens; same IP -> same token.
    expect(prompt).toContain("HOST_A");
    expect(prompt).toContain("sourceHost");
    expect(prompt).toContain("srcHost");
  });

  it("masks IPs and MACs consistently in free text", () => {
    const prompt = buildSiemAiPrompt({
      maxRawLength: 2000,
      finding: {
        id: 1, title: "t", severity: "High", status: "Open",
        summary: "traffic from 192.168.1.10 to 192.168.1.20",
        humanAnalysis: null, recommendedAction: null, eventCount: 1,
        correlationKey: "k", sourceIp: "192.168.1.10", deviceName: "CoreSW",
        ruleName: "r", ruleDescription: "d",
      },
      events: [{
        id: 1, receivedAt: new Date("2026-05-24T12:00:00.000Z"),
        category: "Network", normalizedType: null, action: null, outcome: null,
        username: null, srcIp: "192.168.1.10", dstIp: "192.168.1.20",
        message: "src 192.168.1.10 mac 00:1a:2b:3c:4d:5e dst 192.168.1.20",
        rawMessage: null,
      }],
    });
    expect(prompt).not.toContain("192.168.1.10");
    expect(prompt).not.toContain("192.168.1.20");
    expect(prompt).not.toContain("00:1a:2b:3c:4d:5e");
    expect(prompt).not.toContain("CoreSW");
    // sourceIp, srcIp in event, and the in-text IP all map to the same token.
    expect(prompt).toContain("HOST_A");
    expect(prompt).toContain("HOST_B");
    expect(prompt).toContain("MAC_A");
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
