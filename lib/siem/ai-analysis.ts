import { createHostMasker, redactSensitiveText } from "./redaction";

export type SiemAiSettingsInput = {
  aiEnabled: boolean;
  aiEndpointUrl: string | null;
  aiApiKey: string | null;
  aiDefaultModel: string | null;
  aiMaxSampleEvents: number;
  aiMaxRawLength: number;
};

export type SiemAiFindingInput = {
  id: number;
  title: string;
  severity: string;
  status: string;
  summary: string;
  humanAnalysis: string | null;
  recommendedAction: string | null;
  eventCount: number;
  correlationKey: string;
  sourceIp: string | null;
  deviceName: string | null;
  ruleName: string | null;
  ruleDescription: string | null;
};

export type SiemAiEventSample = {
  id: number;
  receivedAt: Date;
  category: string | null;
  normalizedType: string | null;
  action: string | null;
  outcome: string | null;
  username: string | null;
  srcIp: string | null;
  dstIp: string | null;
  message: string;
  rawMessage: string | null;
};

export type SiemAiAnalysis = {
  generatedAt: string;
  model: string;
  summary: string;
  likelyCause: string;
  impact: string;
  recommendedActions: string[];
  evidence: string[];
};

export function normalizeOpenAiCompatibleEndpoint(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

export function buildSiemAiPrompt(input: { finding: SiemAiFindingInput; events: SiemAiEventSample[]; maxRawLength: number }) {
  const finding = input.finding;
  // One masker per prompt: IPs/MACs become stable HOST_x/MAC_x tokens so the
  // AI can correlate relationships without ever seeing a real address. We send
  // no device identity (name/model/vendor) — only severity, category, the
  // syslog message, and analysis text. Scrub secrets, then mask hosts.
  const mask = createHostMasker();
  const scrub = (value: string) => mask.text(redactSensitiveText(value));

  // Pre-register every username so scrub() also masks the name where it appears
  // inside syslog message text, not just in the structured field.
  for (const event of input.events) mask.user(event.username);

  const events = input.events.map((event) => ({
    id: event.id,
    receivedAt: event.receivedAt.toISOString(),
    category: event.category,
    normalizedType: event.normalizedType,
    action: event.action,
    outcome: event.outcome,
    user: mask.user(event.username),
    srcHost: mask.host(event.srcIp),
    dstHost: mask.host(event.dstIp),
    message: scrub(event.message).slice(0, input.maxRawLength),
    rawMessage: event.rawMessage ? scrub(event.rawMessage).slice(0, input.maxRawLength) : null,
  }));

  return [
    "You are a defensive SIEM analyst. Use only evidence in this prompt. Do not invent external facts, IP reputation, malware names, or user intent. Do not recommend destructive action first.",
    "Hosts are masked as HOST_x tokens; treat them as opaque identifiers and do not guess real addresses or device identities.",
    "Return strict JSON with keys: summary, likelyCause, impact, recommendedActions, evidence. recommendedActions and evidence must be arrays of strings.",
    "Finding:",
    JSON.stringify({
      id: finding.id,
      title: finding.title,
      severity: finding.severity,
      status: finding.status,
      summary: scrub(finding.summary),
      humanAnalysis: finding.humanAnalysis ? scrub(finding.humanAnalysis) : null,
      recommendedAction: finding.recommendedAction ? scrub(finding.recommendedAction) : null,
      eventCount: finding.eventCount,
      sourceHost: mask.host(finding.sourceIp),
      ruleName: finding.ruleName,
      ruleDescription: finding.ruleDescription ? scrub(finding.ruleDescription) : null,
    }, null, 2),
    "Sample events:",
    JSON.stringify(events, null, 2),
  ].join("\n");
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// Providers (esp. reasoning models like DeepSeek) often wrap the JSON in
// markdown fences or append trailing reasoning text after the object, so a
// naive JSON.parse on the whole content throws. Extract the first balanced
// top-level JSON object instead.
export function extractFirstJsonObject(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to extraction
  }

  // Strip a leading ```json / ``` fence and anything after a closing fence.
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try {
    return JSON.parse(fenced.trim());
  } catch {
    // fall through to balanced-brace scan
  }

  const source = fenced;
  const start = source.indexOf("{");
  if (start === -1) throw new Error("AI provider returned no JSON object.");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(start, i + 1));
    }
  }
  throw new Error("AI provider returned malformed JSON.");
}

export function normalizeSiemAiAnalysis(value: unknown, model: string, generatedAt = new Date()): SiemAiAnalysis {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    generatedAt: generatedAt.toISOString(),
    model,
    summary: typeof record.summary === "string" ? record.summary : "No summary returned.",
    likelyCause: typeof record.likelyCause === "string" ? record.likelyCause : "Unknown from provided evidence.",
    impact: typeof record.impact === "string" ? record.impact : "Unknown from provided evidence.",
    recommendedActions: asStringArray(record.recommendedActions),
    evidence: asStringArray(record.evidence),
  };
}

type ChatCompletionLike = {
  choices?: { message?: { content?: string }; delta?: { content?: string } }[];
};

// Pull the assistant message content out of a parsed chat-completion object,
// accepting both the non-streaming shape (choices[].message.content) and a
// single streaming chunk shape (choices[].delta.content).
function readChoiceContent(parsed: ChatCompletionLike): string {
  const choice = parsed.choices?.[0];
  return choice?.message?.content ?? choice?.delta?.content ?? "";
}

// Some OpenAI-compatible gateways (observed with 9router + DeepSeek on large
// answers) ignore the non-streaming request and return Content-Type
// text/event-stream. The body is then either a single completion object with a
// trailing `data: [DONE]` marker, or a real SSE stream of `data: {...}` chunks.
// A plain JSON.parse on that whole body throws "non-whitespace after JSON", so
// parse the envelope defensively here, before extracting the inner analysis.
export function parseChatCompletionBody(raw: string): string {
  const text = raw.trim();
  if (!text) throw new Error("AI provider returned empty response.");

  // Fast path: a clean JSON object body.
  if (!text.includes("data:")) {
    return readChoiceContent(JSON.parse(text) as ChatCompletionLike);
  }

  // SSE path: collect `data:` payloads, ignore the [DONE] sentinel, and
  // concatenate streamed deltas (non-streamed bodies yield a single chunk).
  let streamed = "";
  let lastMessage = "";
  let sawChunk = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let parsed: ChatCompletionLike;
    try {
      parsed = JSON.parse(payload) as ChatCompletionLike;
    } catch {
      continue; // skip keep-alive / non-JSON event lines
    }
    sawChunk = true;
    const choice = parsed.choices?.[0];
    if (choice?.delta?.content) streamed += choice.delta.content;
    if (choice?.message?.content) lastMessage = choice.message.content;
  }

  // The first `data:` may itself be a full completion object directly
  // concatenated with `data: [DONE]` (no newline between them); handle that by
  // parsing up to the first balanced JSON object when line-splitting found none.
  if (!sawChunk) {
    const idx = text.indexOf("data:");
    const head = idx > 0 ? text.slice(0, idx).trim() : "";
    if (head) return readChoiceContent(JSON.parse(head) as ChatCompletionLike);
  }

  const content = streamed || lastMessage;
  if (!content) throw new Error("AI provider returned empty response.");
  return content;
}

export async function requestSiemAiAnalysis(input: { endpointUrl: string; apiKey?: string | null; model: string; prompt: string; fetchFn?: typeof fetch }) {
  const fetchImpl = input.fetchFn ?? fetch;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = input.apiKey?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  // Minimal body only. We deliberately do NOT send `temperature` or
  // `response_format`: the router in front of Anthropic models rejects
  // `temperature` ("deprecated for this model") AND error-caches that 400 for
  // ~30s, so a drop-and-retry hits the cached failure and never reaches the
  // model. A bare request (model + messages) is the one shape proven to work
  // across DeepSeek, Anthropic, GPT, and Gemini behind this gateway. Strict
  // JSON is enforced by the prompt + extractFirstJsonObject, not by
  // response_format.
  const body: Record<string, unknown> = {
    model: input.model,
    messages: [
      { role: "system", content: "You produce evidence-only defensive SIEM analysis as strict JSON." },
      { role: "user", content: input.prompt },
    ],
    stream: false,
  };

  {
    const response = await fetchImpl(input.endpointUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (response.ok) {
      // Read the raw body and parse the envelope ourselves: the provider
      // sometimes replies with text/event-stream even for a non-streaming
      // request, which response.json() cannot handle.
      const raw = await response.text();
      const content = parseChatCompletionBody(raw);
      if (!content) throw new Error("AI provider returned empty response.");
      return extractFirstJsonObject(content);
    }

    const errorBody = await response.text().catch(() => "");
    const snippet = errorBody.trim().slice(0, 200);
    throw new Error(`AI provider rejected request (HTTP ${response.status})${snippet ? `: ${snippet}` : "."}`);
  }
}
