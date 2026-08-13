// Pure: turn a host (domain or IP:port) into an HTTP origin a Telegram
// recipient can reach. Domain   -> https, localhost -> http, IP -> https.
// Kept import-free so it stays testable without loading the DB graph.
export function secureOrigin(host: string) {
  const base = host.trim();
  if (/^https?:\/\//i.test(base)) return base;
  return `${/localhost/i.test(base) ? "http" : "https"}://${base}`;
}