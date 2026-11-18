import { describe, expect, it } from "vitest";
import { buildSiemAiPrompt, detectAiAuthRequirement, extractFirstJsonObject, normalizeOpenAiCompatibleEndpoint, normalizeSiemAiAnalysis, parseChatCompletionBody, requestSiemAiAnalysis } from "./ai-analysis";

describe("SIEM AI analysis", () => {
  it("normalizes OpenAI-compatible chat completion endpoints", () => {
    expect(normalizeOpenAiCompatibleEndpoint("https://api.9router.example/v1")).toBe("https://api.9router.example/v1/chat/completions");
    expect(normalizeOpenAiCompatibleEndpoint("https://api.9router.example/v1/chat/completions")).toBe("https://api.9router.example/v1/chat/completions");
    expect(normalizeOpenAiCompatibleEndpoint(" ")).toBeNull();
    expect(normalizeOpenAiCompatibleEndpoint(null)).toBeNull();
  });

  it("keeps query strings after the appended chat path (Azure/gateway style)", () => {
    expect(
      normalizeOpenAiCompatibleEndpoint("https://gw.example/openai/deployments/d1?api-version=2024-10-21"),
    ).toBe("https://gw.example/openai/deployments/d1/chat/completions?api-version=2024-10-21");
    // A URL that already is a chat endpoint keeps its query untouched.
    expect(
      normalizeOpenAiCompatibleEndpoint("https://gw.example/v1/chat/completions?api-version=1"),
    ).toBe("https://gw.example/v1/chat/completions?api-version=1");
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

  it("parses content returned as an array of content parts (Chat Completions spec)", () => {
    const body = JSON.stringify({
      choices: [{ message: { role: "assistant", content: [{ type: "text", text: '{"summary":"parts"}' }] } }],
    });
    expect(parseChatCompletionBody(body)).toBe('{"summary":"parts"}');
  });

  it("parses concatenated content parts and array-shaped stream deltas", () => {
    const body = JSON.stringify({
      choices: [{ message: { content: [{ type: "text", text: '{"sum' }, { type: "text", text: 'mary":"x"}' }] } }],
    });
    expect(parseChatCompletionBody(body)).toBe('{"summary":"x"}');

    const chunk = (delta: unknown) => `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`;
    const sse = chunk([{ type: "text", text: '{"sum' }]) + chunk([{ type: "text", text: 'mary":"y"}' }]) + "data: [DONE]\n\n";
    expect(parseChatCompletionBody(sse)).toBe('{"summary":"y"}');
  });

  it("falls back to reasoning_content when content is null", () => {
    const body = JSON.stringify({
      choices: [{ message: { role: "assistant", content: null, reasoning_content: '{"summary":"from reasoning"}' } }],
    });
    expect(parseChatCompletionBody(body)).toBe('{"summary":"from reasoning"}');
  });

  it("uses refusal text when the model refuses to answer", () => {
    const body = JSON.stringify({ choices: [{ message: { content: null, refusal: "I cannot help with that." } }] });
    expect(parseChatCompletionBody(body)).toBe("I cannot help with that.");
  });

  it("does not mis-route a JSON body to the SSE parser just because content contains 'data:'", () => {
    // Regression: the old fast-path test was `text.includes("data:")`, so any
    // analysis text containing "data:" made JSON.parse run on an SSE-truncated
    // slice and threw a SyntaxError.
    const body = JSON.stringify({
      choices: [{ message: { content: '{"summary":"raw log data: 10.0.0.1 -> 10.0.0.2"}' } }],
    });
    expect(parseChatCompletionBody(body)).toBe('{"summary":"raw log data: 10.0.0.1 -> 10.0.0.2"}');
  });

  it("accepts an unwrapped analysis object from thin proxies", () => {
    const body = JSON.stringify({ summary: "direct", likelyCause: "x", impact: "y", recommendedActions: [], evidence: [] });
    expect(parseChatCompletionBody(body)).toBe(body);
  });

  it("reads the OpenAI Responses shape returned by Codex-backed routers", () => {
    expect(parseChatCompletionBody(JSON.stringify({
      object: "response",
      output_text: '{"summary":"responses-api"}',
      output: [{ type: "message", content: [{ type: "output_text", text: '{"summary":"responses-api"}' }] }],
    }))).toBe('{"summary":"responses-api"}');

    // Without the convenience `output_text` field.
    expect(parseChatCompletionBody(JSON.stringify({
      object: "response",
      output: [{ type: "message", content: [{ type: "output_text", text: '{"summary":"nested"}' }] }],
    }))).toBe('{"summary":"nested"}');
  });

  it("reads an Anthropic-style content block body from a translating router", () => {
    const body = JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: '{"summary":"anthropic"}' }],
    });
    expect(parseChatCompletionBody(body)).toBe('{"summary":"anthropic"}');
  });

  it("reassembles Responses API text-delta events and Anthropic content deltas", () => {
    const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

    const responses = event({ type: "response.created" })
      + event({ type: "response.output_text.delta", delta: '{"summary":' })
      + event({ type: "response.output_text.delta", delta: '"responses-stream"}' })
      + event({ type: "response.completed", response: { output_text: '{"summary":"responses-stream"}' } })
      + "data: [DONE]\n\n";
    expect(parseChatCompletionBody(responses)).toBe('{"summary":"responses-stream"}');

    const anthropic = event({ type: "message_start", message: { id: "m1" } })
      + event({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })
      + event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"summary":"claude-stream"}' } })
      + event({ type: "message_stop" });
    expect(parseChatCompletionBody(anthropic)).toBe('{"summary":"claude-stream"}');
  });

  it("uses the completed Responses object when the stream carried no deltas", () => {
    const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
    const body = event({ type: "response.created" })
      + event({ type: "response.completed", response: { output_text: '{"summary":"only-done"}' } })
      + "data: [DONE]\n\n";
    expect(parseChatCompletionBody(body)).toBe('{"summary":"only-done"}');
  });

  it("raises the provider message when a 200 body carries an error object", () => {
    expect(() => parseChatCompletionBody(JSON.stringify({ error: { message: "context length exceeded", type: "invalid_request_error" } })))
      .toThrow(/context length exceeded/);
  });

  it("reports truncation instead of a generic empty response", () => {
    expect(() => parseChatCompletionBody(JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "length" }] })))
      .toThrow(/finish_reason=length/);
  });

  it("includes the provider error detail (redacted) on a non-2xx response", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({ error: { message: "Incorrect API key provided: sk-abcdef1234567890", type: "invalid_request_error" } }),
        { status: 401 },
      )) as unknown as typeof fetch;

    const error = await requestSiemAiAnalysis({ endpointUrl: "https://router.local/v1/chat/completions", model: "m", prompt: "p", fetchFn })
      .then(() => null)
      .catch((cause: unknown) => (cause instanceof Error ? cause.message : String(cause)));

    expect(error).toMatch(/HTTP 401\).*Incorrect API key provided/);
    expect(error).not.toMatch(/sk-abcdef1234567890/);
  });

  it("retries once with the developer role when an OpenAI reasoning model rejects 'system'", async () => {
    const roles: string[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { messages: { role: string }[] };
      roles.push(body.messages[0].role);
      if (body.messages[0].role === "system") {
        return new Response(
          JSON.stringify({
            error: {
              message: "Unsupported value: 'messages[0].role' does not support 'system' with this model. Supported values are: 'developer' and 'user'.",
              type: "invalid_request_error",
            },
          }),
          { status: 400 },
        );
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"reasoning-model-ok"}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await requestSiemAiAnalysis({ endpointUrl: "https://api.openai.com/v1/chat/completions", model: "gpt-5", prompt: "p", fetchFn });
    expect(result).toEqual({ summary: "reasoning-model-ok" });
    expect(roles).toEqual(["system", "developer"]);
  });

  it("does not retry unrelated 400s", async () => {
    const roles: string[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { messages: { role: string }[] };
      roles.push(body.messages[0].role);
      return new Response(JSON.stringify({ error: { message: "The model `bogus` does not exist" } }), { status: 400 });
    }) as unknown as typeof fetch;

    await expect(
      requestSiemAiAnalysis({ endpointUrl: "https://router.local/v1/chat/completions", model: "bogus", prompt: "p", fetchFn }),
    ).rejects.toThrow(/HTTP 400\).*The model `bogus` does not exist/);
    expect(roles).toEqual(["system"]);
  });

  it("retries with stream:true when the router requires streaming (Codex backends)", async () => {
    const streams: boolean[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { stream: boolean };
      streams.push(body.stream);
      if (!body.stream) {
        return new Response(JSON.stringify({ detail: "Stream must be set to true for this model" }), { status: 400 });
      }
      const chunk = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
      return new Response(chunk('{"summary":') + chunk('"streamed-router"}') + "data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    const result = await requestSiemAiAnalysis({ endpointUrl: "https://router.local/v1/chat/completions", model: "cx/gpt-5", prompt: "p", fetchFn });
    expect(result).toEqual({ summary: "streamed-router" });
    expect(streams).toEqual([false, true]);
  });

  it("does not retry with stream:true when the router says streaming is unsupported", async () => {
    const streams: boolean[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { stream: boolean };
      streams.push(body.stream);
      return new Response(JSON.stringify({ error: { message: "Streaming is not supported for this model" } }), { status: 400 });
    }) as unknown as typeof fetch;

    await expect(
      requestSiemAiAnalysis({ endpointUrl: "https://router.local/v1/chat/completions", model: "m", prompt: "p", fetchFn }),
    ).rejects.toThrow(/Streaming is not supported/);
    expect(streams).toEqual([false]);
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

describe("detectAiAuthRequirement", () => {
  it("returns requiresKey=true on 401", async () => {
    const fetchFn = (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    const result = await detectAiAuthRequirement("https://router.local/v1", fetchFn);
    expect(result.requiresKey).toBe(true);
    expect(result.status).toBe(401);
    expect(result.error).toBeUndefined();
  });

  it("returns requiresKey=true on 403", async () => {
    const fetchFn = (async () => new Response("forbidden", { status: 403 })) as unknown as typeof fetch;
    const result = await detectAiAuthRequirement("https://router.local/v1", fetchFn);
    expect(result.requiresKey).toBe(true);
    expect(result.status).toBe(403);
  });

  it("returns requiresKey=false on 200", async () => {
    const fetchFn = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const result = await detectAiAuthRequirement("https://router.local/v1/models", fetchFn);
    expect(result.requiresKey).toBe(false);
    expect(result.status).toBe(200);
    expect(result.error).toBeUndefined();
  });

  it("returns requiresKey=false on 405 method not allowed (endpoint reachable, no key needed for HEAD)", async () => {
    const fetchFn = (async () => new Response("method not allowed", { status: 405 })) as unknown as typeof fetch;
    const result = await detectAiAuthRequirement("https://router.local/v1/chat/completions", fetchFn);
    expect(result.requiresKey).toBe(false);
    expect(result.status).toBe(405);
  });

  it("returns requiresKey=true and surfaces the error on network failure", async () => {
    const fetchFn = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const result = await detectAiAuthRequirement("https://unreachable.local/v1", fetchFn);
    expect(result.requiresKey).toBe(true);
    expect(result.status).toBe(0);
    expect(result.error).toContain("ECONNREFUSED");
  });
});
