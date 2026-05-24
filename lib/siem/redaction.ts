export function redactSensitiveText(value: string) {
  return value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(password|passwd|pwd)\s*([:=])\s*([^\s,;]+)/gi, "$1$2[REDACTED]")
    .replace(/\b(token|secret|api[_-]?key)\s*([:=])\s*([^\s,;]+)/gi, "$1$2[REDACTED]")
    .replace(/\bauthorization\s*([:=])\s*(bearer\s+)?([^\s,;]+)/gi, "authorization$1$2[REDACTED]")
    .replace(/\b(session|cookie)\s*([:=])\s*([^\s,;]+)/gi, "$1$2[REDACTED]");
}
