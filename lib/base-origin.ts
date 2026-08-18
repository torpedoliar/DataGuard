// Pure: turn a host (domain or IP:port) into an HTTP origin a Telegram
// recipient can reach. A value that already carries an explicit http(s)
// scheme is returned untouched, so an https:// APP_URL keeps working on TLS
// deployments. Otherwise external domain names default to https, while
// localhost and plain-IP LAN hosts (the primary on-prem deployment is a
// docker-compose app on port 3001 with no TLS) default to http. Kept
// import-free so it stays testable without loading the DB graph.
export function secureOrigin(host: string) {
  const base = host.trim();
  if (/^https?:\/\//i.test(base)) return base;
  const isPlainIp =
    /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(base) || /^\[[0-9a-f:]+\](:\d+)?$/i.test(base);
  return `${/localhost/i.test(base) || isPlainIp ? "http" : "https"}://${base}`;
}