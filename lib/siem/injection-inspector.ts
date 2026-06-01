export type InjectionIndicator = {
  key: string;
  label: string;
  severity: "low" | "medium" | "high";
  evidence: string;
};

const patterns: Array<{ key: string; label: string; severity: InjectionIndicator["severity"]; regex: RegExp }> = [
  { key: "script_tag", label: "Script tag", severity: "high", regex: /<\s*script\b/i },
  { key: "event_handler", label: "HTML event handler", severity: "high", regex: /\son[a-z]+\s*=/i },
  { key: "javascript_url", label: "JavaScript URL", severity: "high", regex: /\bjavascript\s*:/i },
  { key: "data_html_url", label: "HTML data URL", severity: "medium", regex: /\bdata\s*:\s*text\/html/i },
  { key: "embedded_object", label: "Embedded active content", severity: "medium", regex: /<\s*(iframe|object|embed|svg|math)\b/i },
  { key: "meta_refresh", label: "Meta refresh", severity: "medium", regex: /<\s*meta\b[^>]*http-equiv\s*=\s*["']?refresh/i },
  { key: "css_expression", label: "CSS expression", severity: "medium", regex: /\bexpression\s*\(/i },
  { key: "html_entity", label: "Encoded HTML marker", severity: "low", regex: /&(lt|gt|#x?0*3c|#x?0*3e);/i },
];

function decodeCommonEntities(value: string) {
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x0*3c;/gi, "<")
    .replace(/&#0*60;/g, "<")
    .replace(/&#x0*3e;/gi, ">")
    .replace(/&#0*62;/g, ">");
}

function evidenceFor(value: string, regex: RegExp) {
  const match = regex.exec(value);
  if (!match?.index && match?.index !== 0) return "";
  const start = Math.max(0, match.index - 20);
  const end = Math.min(value.length, match.index + match[0].length + 20);
  return value.slice(start, end);
}

export function inspectRawLogInjection(rawLog: string): InjectionIndicator[] {
  const decoded = decodeCommonEntities(rawLog);
  const values = [rawLog, decoded];
  const indicators = new Map<string, InjectionIndicator>();

  for (const pattern of patterns) {
    for (const value of values) {
      if (!pattern.regex.test(value)) continue;
      indicators.set(pattern.key, {
        key: pattern.key,
        label: pattern.label,
        severity: pattern.severity,
        evidence: evidenceFor(value, pattern.regex),
      });
      break;
    }
  }

  return [...indicators.values()];
}

export function hasHighRiskInjectionIndicator(rawLog: string) {
  return inspectRawLogInjection(rawLog).some((indicator) => indicator.severity === "high");
}
