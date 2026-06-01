import { redactSensitiveText } from "./redaction";

export type SiemAiSettingsInput = {
  aiEnabled: boolean;
  aiEndpointUrl: string | null;
  aiApiKey: string | null;
  aiModelOpus: string | null;
  aiModelSonnet: string | null;
  aiModelHaiku: string | null;
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

export function resolveSiemAiModel(settings: Pick<SiemAiSettingsInput, "aiDefaultModel" | "aiModelOpus" | "aiModelSonnet" | "aiModelHaiku">) {
  return settings.aiDefaultModel?.trim() || settings.aiModelSonnet?.trim() || settings.aiModelOpus?.trim() || settings.aiModelHaiku?.trim() || null;
}

export function buildSiemAiPrompt(input: { finding: SiemAiFindingInput; events: SiemAiEventSample[]; maxRawLength: number }) {
  const finding = input.finding;
  const events = input.events.map((event) => ({
    id: event.id,
    receivedAt: event.receivedAt.toISOString(),
    category: event.category,
    normalizedType: event.normalizedType,
    action: event.action,
    outcome: event.outcome,
    username: event.username,
    srcIp: event.srcIp,
    dstIp: event.dstIp,
    message: redactSensitiveText(event.message).slice(0, input.maxRawLength),
    rawMessage: event.rawMessage ? redactSensitiveText(event.rawMessage).slice(0, input.maxRawLength) : null,
  }));

  return [
    "You are a defensive SIEM analyst. Use only evidence in this prompt. Do not invent external facts, IP reputation, malware names, or user intent. Do not recommend destructive action first.",
    "Return strict JSON with keys: summary, likelyCause, impact, recommendedActions, evidence. recommendedActions and evidence must be arrays of strings.",
    "Finding:",
    JSON.stringify({
      id: finding.id,
      title: finding.title,
      severity: finding.severity,
      status: finding.status,
      summary: redactSensitiveText(finding.summary),
      humanAnalysis: finding.humanAnalysis ? redactSensitiveText(finding.humanAnalysis) : null,
      recommendedAction: finding.recommendedAction ? redactSensitiveText(finding.recommendedAction) : null,
      eventCount: finding.eventCount,
      correlationKey: finding.correlationKey,
      sourceIp: finding.sourceIp,
      deviceName: finding.deviceName,
      ruleName: finding.ruleName,
      ruleDescription: finding.ruleDescription,
    }, null, 2),
    "Sample events:",
    JSON.stringify(events, null, 2),
  ].join("\n");
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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

export async function requestSiemAiAnalysis(input: { endpointUrl: string; apiKey: string; model: string; prompt: string; fetchFn?: typeof fetch }) {
  const fetchImpl = input.fetchFn ?? fetch;
  const response = await fetchImpl(input.endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: "You produce evidence-only defensive SIEM analysis as strict JSON." },
        { role: "user", content: input.prompt },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) throw new Error("AI provider rejected request.");
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI provider returned empty response.");
  return JSON.parse(content) as unknown;
}
