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

export function normalizeOpenAiCompatibleEndpoint(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;

  // Split off a query string / fragment before appending the chat path, then
  // put it back. OpenAI-compatible gateways and Azure deployments authenticate
  // or pin a version with query params (`?api-version=...`), and appending
  // after the `?` would silently produce a path the provider cannot route.
  const match = trimmed.match(/^([^?#]*)([?#].*)?$/);
  const pathPart = (match?.[1] ?? trimmed).replace(/\/+$/, "");
  const suffix = match?.[2] ?? "";
  if (!pathPart) return null;

  // Already a chat-completions URL (`/v1/chat/completions`, Azure's
  // `/openai/deployments/<name>/chat/completions`): use as-is.
  if (pathPart.endsWith("/chat/completions")) return `${pathPart}${suffix}`;
  return `${pathPart}/chat/completions${suffix}`;
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

// ---------------------------------------------------------------------------
// OpenAI Chat Completions response adapter
// ---------------------------------------------------------------------------
// The contract we target is `POST /chat/completions` returning either
//   { choices: [{ message: { content } }], ... }             (stream: false)
// or a text/event-stream of
//   data: { choices: [{ delta: { content } }] }
//   data: [DONE]
// Real gateways deviate in ways that used to break us, so tolerate:
//   - `content` as a string OR an array of content parts
//     (`[{ type: "text", text: "..." }]`) — legal in the Chat Completions API;
//   - `content: null` with the answer in `reasoning_content` / `reasoning`;
//   - `refusal` instead of `content`;
//   - a 200 body carrying `{ error: ... }` instead of `choices`;
//   - an unwrapped analysis object (no envelope) from thin proxies.
type ChatMessageLike = {
  content?: unknown;
  refusal?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
};

type ChatChoiceLike = {
  message?: ChatMessageLike;
  delta?: ChatMessageLike;
  text?: unknown;
  finish_reason?: unknown;
};

// Flatten a content value to text. Chat Completions allows a plain string or
// an array of parts, so callers never have to care which shape was returned.
function contentToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => contentToText(part)).join("");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "content", "value"]) {
      const text = contentToText(record[key]);
      if (text) return text;
    }
  }
  return "";
}

// Provider errors arrive as a string or as a nested object
// (`{ error: { message } }`), so walk the common keys instead of assuming one
// shape. Never echo credentials: invalid-key errors sometimes quote the token.
function providerErrorMessage(value: unknown, depth = 0): string | null {
  if (depth > 3 || value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["message", "error", "detail", "msg", "description"]) {
    const message = providerErrorMessage(record[key], depth + 1);
    if (message) return message;
  }
  return null;
}

function redactProviderDetail(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\s+/g, " ")
    .trim();
}

// Turn a provider error body (JSON or an HTML/plain error page) into one short,
// credential-free line suitable for the operator UI.
function describeErrorBody(body: string) {
  const text = body.trim();
  if (!text) return "";
  try {
    const parsed: unknown = JSON.parse(text);
    const message = providerErrorMessage(parsed);
    if (message) return redactProviderDetail(message).slice(0, 300);
  } catch {
    // Not JSON — fall through to the raw body.
  }
  return redactProviderDetail(text).slice(0, 300);
}

// Pull the assistant text out of one choice, preferring the final answer over
// reasoning text, and accepting both message (non-streaming) and delta
// (streaming) shapes.
function readChoiceContent(choice: ChatChoiceLike | null): string {
  if (!choice) return "";
  const message = choice.message ?? {};
  const delta = choice.delta ?? {};
  return (
    contentToText(message.content) ||
    contentToText(delta.content) ||
    contentToText(choice.text) ||
    contentToText(message.refusal) ||
    contentToText(delta.refusal) ||
    contentToText(message.reasoning_content) ||
    contentToText(delta.reasoning_content) ||
    contentToText(message.reasoning) ||
    contentToText(delta.reasoning)
  );
}

const ANALYSIS_KEYS = ["summary", "likelyCause", "impact", "recommendedActions", "evidence"] as const;

// Routers fronting Codex/Claude models sometimes answer the chat path with the
// OpenAI Responses shape (`output[]` / `output_text`) instead of
// `choices[].message`. Pull the text out of that shape as well.
function responsesText(record: Record<string, unknown>): string {
  if (typeof record.output_text === "string" && record.output_text) return record.output_text;
  if (Array.isArray(record.output)) {
    return record.output
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const entry = item as Record<string, unknown>;
        return contentToText(entry.content) || contentToText(entry.text);
      })
      .join("");
  }
  if (record.response && typeof record.response === "object") {
    return responsesText(record.response as Record<string, unknown>);
  }
  return "";
}

function readCompletionPayload(parsed: unknown, raw: string): string {
  if (typeof parsed === "string") return parsed;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI provider returned an unexpected response shape.");
  }

  const record = parsed as Record<string, unknown>;
  if (record.error !== null && record.error !== undefined) {
    const detail = providerErrorMessage(record.error) ?? "unknown error";
    throw new Error(`AI provider returned an error: ${redactProviderDetail(detail)}`);
  }

  if (Array.isArray(record.choices)) {
    const choice = (record.choices[0] ?? null) as ChatChoiceLike | null;
    const content = readChoiceContent(choice);
    if (content) return content;
    const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
    if (finishReason === "length") {
      throw new Error("AI provider truncated the analysis (finish_reason=length). Reduce Sample Events / Max Raw Length and retry.");
    }
    if (finishReason === "content_filter") {
      throw new Error("AI provider blocked the response (finish_reason=content_filter).");
    }
    throw new Error(`AI provider returned an empty message${finishReason ? ` (finish_reason=${finishReason})` : ""}.`);
  }

  // Thin proxies sometimes unwrap the envelope and return the model's JSON
  // object directly. Accept a valid analysis instead of failing it.
  if (ANALYSIS_KEYS.some((key) => key in record)) return raw;

  // OpenAI Responses shape (Codex-backed routers).
  const responses = responsesText(record);
  if (responses) return responses;

  // Anthropic Messages / generic content-block shape: { content: [...] } or
  // { content: "..." }. Only reached when there is no chat-completion envelope.
  const content = contentToText(record.content);
  if (content) return content;

  // Last resort for routers that wrap the answer in a plain text field.
  const text = contentToText(record.text) || contentToText(record.message);
  if (text) return text;

  const shape = redactProviderDetail(JSON.stringify(record).slice(0, 200));
  throw new Error(`AI provider returned an unexpected response shape${shape ? `: ${shape}` : "."}`);
}

type SseParseState = { content: string; reasoning: string; finishReason: string; sawEvent: boolean; error?: string };

function consumeSseBlock(block: string, state: SseParseState) {
  // One SSE event may span several `data:` lines (the spec joins them with
  // newlines), so collect the whole block before parsing.
  const dataLines = block
    .split(/\r?\n/)
    .map((line) => line.trimStart())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).replace(/^ /, ""));
  const payload = dataLines.filter((line) => line.trim() !== "[DONE]").join("\n").trim();
  if (!payload) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return; // keep-alive / partial or non-JSON event line
  }
  state.sawEvent = true;

  const record = parsed as Record<string, unknown>;
  if (record.error !== null && record.error !== undefined) {
    state.error = redactProviderDetail(providerErrorMessage(record.error) ?? "unknown error");
    return;
  }

  const type = typeof record.type === "string" ? record.type : "";

  // Some routers expose Codex/Claude models through the chat path but stream
  // the upstream event shapes. Handle the common text-delta events so a router
  // bridge still yields the analysis text.
  if (!Array.isArray(record.choices)) {
    if (type === "response.output_text.delta" || type === "response.refusal.delta") {
      state.content += contentToText(record.delta);
      return;
    }
    if (type === "response.output_text.done") {
      if (!state.content) state.content = contentToText(record.text);
      return;
    }
    if (type === "response.completed" || type === "response.done") {
      if (!state.content) {
        state.content = record.response && typeof record.response === "object"
          ? responsesText(record.response as Record<string, unknown>)
          : responsesText(record);
      }
      return;
    }
    if (type === "content_block_delta") {
      state.content += contentToText(record.delta);
      return;
    }
    if (type === "content_block_start") {
      if (!state.content) {
        state.content = contentToText((record.content_block as Record<string, unknown> | undefined)?.text);
      }
      return;
    }
    return;
  }

  const choice = (record.choices[0] ?? null) as ChatChoiceLike | null;
  if (!choice) return;
  const delta = choice.delta ?? {};
  const message = choice.message ?? {};
  // Prefer delta chunks. A few gateways also attach the full message on the
  // final chunk; only fall back to it when no delta text has arrived, so the
  // answer is not duplicated.
  const deltaContent = contentToText(delta.content) || contentToText(delta.refusal);
  if (deltaContent) state.content += deltaContent;
  else if (!state.content) {
    state.content += contentToText(message.content) || contentToText(choice.text) || contentToText(message.refusal);
  }
  const deltaReasoning = contentToText(delta.reasoning_content) || contentToText(delta.reasoning);
  if (deltaReasoning) state.reasoning += deltaReasoning;
  else if (!state.reasoning) {
    state.reasoning += contentToText(message.reasoning_content) || contentToText(message.reasoning);
  }
  if (typeof choice.finish_reason === "string") state.finishReason = choice.finish_reason;
}

function parseSseBlocks(blocks: string[]): SseParseState {
  const state: SseParseState = { content: "", reasoning: "", finishReason: "", sawEvent: false };
  for (const block of blocks) consumeSseBlock(block, state);
  return state;
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
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

  // Canonical path: the body is one JSON chat-completion envelope. Try JSON
  // first and never sniff for a `data:` substring — the assistant's own text
  // may contain it, which previously mis-routed valid JSON into the SSE parser.
  const direct = tryParseJson(text);
  if (direct.ok) return readCompletionPayload(direct.value, text);

  // Non-streaming requests are sometimes answered with the full envelope plus a
  // trailing SSE sentinel (`...}data: [DONE]`). Strip it and retry.
  const withoutSentinel = text.replace(/\s*data:\s*\[DONE\]\s*$/i, "").trim();
  if (withoutSentinel !== text) {
    const parsed = tryParseJson(withoutSentinel);
    if (parsed.ok) return readCompletionPayload(parsed.value, withoutSentinel);
  }

  // Real SSE stream: split on blank lines per the spec, then fall back to
  // per-line parsing for gateways that omit the blank separator.
  const blockState = parseSseBlocks(text.split(/\r?\n\r?\n/));
  const state = blockState.sawEvent ? blockState : parseSseBlocks(text.split(/\r?\n/));

  if (state.error) throw new Error(`AI provider returned an error: ${state.error}`);
  const content = state.content || state.reasoning;
  if (content) return content;
  if (state.finishReason === "length") {
    throw new Error("AI provider truncated the analysis (finish_reason=length). Reduce Sample Events / Max Raw Length and retry.");
  }
  throw new Error("AI provider returned empty response.");
}

const SYSTEM_PROMPT = "You produce evidence-only defensive SIEM analysis as strict JSON.";

function buildChatBody(input: { model: string; prompt: string }, options: { systemRole: "system" | "developer"; stream: boolean }) {
  return {
    model: input.model,
    messages: [
      { role: options.systemRole, content: SYSTEM_PROMPT },
      { role: "user", content: input.prompt },
    ],
    stream: options.stream,
  };
}

// OpenAI's reasoning models (o1/o3/o4/gpt-5 on api.openai.com) reject the
// legacy `system` role: "Unsupported value: 'messages[0].role' does not support
// 'system' with this model. Supported values are: 'developer' and 'user'."
// Detect exactly that class of 400 so we retry once with the `developer` role
// the Chat Completions spec defines for those models. Other 400s (bad model,
// deprecated params) are surfaced without retrying.
export function shouldRetryWithDeveloperRole(detail: string) {
  return /\bsystem\b/i.test(detail) && /(unsupported|not supported|invalid|deprecated|developer)/i.test(detail);
}

// Routers bridging to Codex/ChatGPT backends sometimes expose the chat path but
// only accept `stream: true`. Detect that specific 400 and retry once with
// streaming, which parseChatCompletionBody already understands. A plain
// "streaming is not supported" is NOT retried.
export function shouldRetryWithStream(detail: string) {
  return /\bstream(ing)?\b/i.test(detail) && /\b(must|required|mandatory|only)\b/i.test(detail);
}

export async function requestSiemAiAnalysis(input: { endpointUrl: string; apiKey?: string | null; model: string; prompt: string; fetchFn?: typeof fetch }) {
  const fetchImpl = input.fetchFn ?? fetch;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = input.apiKey?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  // Minimal body only. We deliberately do NOT send `temperature`,
  // `max_tokens`, or `response_format`: the router in front of Anthropic
  // models rejects `temperature` ("deprecated for this model") AND
  // error-caches that 400 for ~30s, so a drop-and-retry hits the cached
  // failure and never reaches the model. A bare request (model + messages) is
  // the one shape proven to work across DeepSeek, Anthropic, GPT, and Gemini
  // behind this gateway. Strict JSON is enforced by the prompt +
  // extractFirstJsonObject, not by response_format.
  let systemRole: "system" | "developer" = "system";
  let stream = false;
  let lastStatus = 0;
  let lastDetail = "";

  // At most three requests: initial, +developer role, +stream. Both fallbacks
  // are one-way switches, so this loop cannot spin.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchImpl(input.endpointUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(buildChatBody(input, { systemRole, stream })),
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

    lastStatus = response.status;
    lastDetail = describeErrorBody(await response.text().catch(() => ""));

    if (lastStatus === 400 && systemRole === "system" && shouldRetryWithDeveloperRole(lastDetail)) {
      systemRole = "developer";
      continue;
    }
    if (lastStatus === 400 && !stream && shouldRetryWithStream(lastDetail)) {
      stream = true;
      continue;
    }
    break;
  }

  throw new Error(`AI provider rejected request (HTTP ${lastStatus})${lastDetail ? `: ${lastDetail}` : "."}`);
}

// Lightly probe an OpenAI-compatible endpoint to figure out whether the
// gateway in front of it (e.g. 9router) requires a caller-supplied API key.
// The UI labels the key as "optional" today, which causes confusing 401s for
// operators running behind an auth-required gateway. The check is best-effort:
// any 401/403 means a key is needed; 2xx or 405 (method not allowed on a
// reachable server) means no key is required for plain chat calls. A network
// failure is treated as "unknown" → `requiresKey: true` so admins are warned
// to set a key before saving.
export type AiAuthProbe = { requiresKey: boolean; status: number; error?: string };

export async function detectAiAuthRequirement(
  endpointUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<AiAuthProbe> {
  // Probe against the base URL (strip a trailing /chat/completions if the
  // operator pasted the full chat URL, since HEADing that is wasteful).
  const probeUrl = endpointUrl.replace(/\/chat\/completions\/?$/i, "").replace(/\/+$/, "");
  try {
    const response = await fetchFn(probeUrl, { method: "HEAD" });
    if (response.status === 401 || response.status === 403) {
      return { requiresKey: true, status: response.status };
    }
    if (response.status >= 200 && response.status < 500) {
      return { requiresKey: false, status: response.status };
    }
    // 5xx: assume the key is fine (server is the problem).
    return { requiresKey: false, status: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    return { requiresKey: true, status: 0, error: message };
  }
}
