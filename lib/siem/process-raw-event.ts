import { normalizeCisco } from "./normalizers/cisco";
import { normalizeFortigate } from "./normalizers/fortigate";
import { normalizeGeneric } from "./normalizers/generic";
import { normalizeLinux } from "./normalizers/linux";
import { normalizeMikrotik } from "./normalizers/mikrotik";
import { normalizeWatchguard } from "./normalizers/watchguard";
import { parseSyslogMessage } from "./syslog-parser";
import type { SiemVendor } from "./types";

export function processRawSyslogEvent(input: { rawMessage: string; vendor: SiemVendor }) {
  const parsed = parseSyslogMessage(input.rawMessage);
  const normalizer = input.vendor === "cisco" ? normalizeCisco : input.vendor === "fortigate" ? normalizeFortigate : input.vendor === "linux" ? normalizeLinux : input.vendor === "mikrotik" ? normalizeMikrotik : input.vendor === "watchguard" ? normalizeWatchguard : normalizeGeneric;
  const normalized = normalizer(parsed.message);

  return {
    ...parsed,
    ...normalized,
    ingestStatus: parsed.parser === "fallback" ? "parse_failed" as const : "parsed" as const,
  };
}
