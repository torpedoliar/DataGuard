export function redactSensitiveText(value: string) {
  return value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(password|passwd|pwd)\s*([:=])\s*([^\s,;]+)/gi, "$1$2[REDACTED]")
    .replace(/\b(token|secret|api[_-]?key)\s*([:=])\s*([^\s,;]+)/gi, "$1$2[REDACTED]")
    .replace(/\bauthorization\s*([:=])\s*(bearer\s+)?([^\s,;]+)/gi, "authorization$1$2[REDACTED]")
    .replace(/\b(session|cookie)\s*([:=])\s*([^\s,;]+)/gi, "$1$2[REDACTED]");
}

// MAC must run before IPv6: a MAC like 00:1a:2b:3c:4d:5e also matches the IPv6
// colon-group pattern, so consume it first.
const MAC_RE = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;
const IPV6_RE = /\b(?:[0-9A-Fa-f]{1,4}:){2,7}[0-9A-Fa-f]{1,4}\b|(?:[0-9A-Fa-f]{1,4}:){1,7}:|::(?:[0-9A-Fa-f]{1,4}:){0,6}[0-9A-Fa-f]{1,4}/g;
const IPV4_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

function tokenLabel(n: number) {
  // 0 -> A, 25 -> Z, 26 -> AA, ...
  let s = "";
  n += 1;
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

// Consistent host/MAC masker: the same IP always maps to the same HOST_x token,
// across both structured fields and free text, so the AI can still correlate
// "host A talked to host B" without ever seeing a real address. Create one per
// prompt so the token namespace is scoped to that analysis.
export function createHostMasker() {
  const hosts = new Map<string, string>();
  const macs = new Map<string, string>();
  const users = new Map<string, string>();

  function host(ip: string | null | undefined): string | null {
    const key = ip?.trim();
    if (!key) return null;
    if (!hosts.has(key)) hosts.set(key, `HOST_${tokenLabel(hosts.size)}`);
    return hosts.get(key)!;
  }

  function mac(value: string): string {
    const key = value.toLowerCase();
    if (!macs.has(key)) macs.set(key, `MAC_${tokenLabel(macs.size)}`);
    return macs.get(key)!;
  }

  // Usernames/account names are PII. Map each to a stable USER_x token so the
  // AI can still track "same actor across events" without seeing real names.
  function user(value: string | null | undefined): string | null {
    const key = value?.trim();
    if (!key) return null;
    if (!users.has(key)) users.set(key, `USER_${tokenLabel(users.size)}`);
    return users.get(key)!;
  }

  // Mask IP/MAC and any already-seen usernames embedded in free text, using the
  // same token maps. Register usernames (via user()) before scrubbing messages
  // so the same account is masked consistently in structured fields and text.
  function text(value: string): string {
    let out = value
      .replace(MAC_RE, (m) => mac(m))
      .replace(IPV6_RE, (ip) => host(ip) ?? ip)
      .replace(IPV4_RE, (ip) => host(ip) ?? ip);
    for (const [name, token] of users) {
      out = out.split(name).join(token);
    }
    return out;
  }

  return { host, mac, user, text };
}
