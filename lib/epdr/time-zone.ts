/** Display preferences are independent of the site's notification scheduling zone. */
export const EPDR_TIME_ZONE_PRESETS = [
  { label: "UTC", value: "UTC" },
  { label: "WIB", value: "Asia/Jakarta" },
  { label: "WITA", value: "Asia/Makassar" },
  { label: "WIT", value: "Asia/Jayapura" },
] as const;

/** Reject offsets, whitespace and POSIX abbreviations; accept named IANA zones and UTC. */
export function isValidEpdrTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100 ||
      (value !== "UTC" && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/.test(value))) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); return true; }
  catch { return false; }
}

/** Shared server/client precedence: personal preference, site scheduling zone, UTC. */
export function resolveEpdrTimeZone(personal: string | null, siteTimeZone?: string): string {
  if (isValidEpdrTimeZone(personal)) return personal;
  return isValidEpdrTimeZone(siteTimeZone) ? siteTimeZone : "UTC";
}

/** An explicit zone is mandatory; never changes the existing WIB date helpers. */
export function formatEpdrDateTime(value: string | number | Date, timeZone: string, locale = "en-GB"): string {
  if (!isValidEpdrTimeZone(timeZone)) throw new Error("invalid_epdr_time_zone");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { timeZone, year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(date);
}

export function epdrLocalClock(date: Date, timeZone: string): { day: string; hour: number } {
  if (!isValidEpdrTimeZone(timeZone) || !Number.isFinite(date.getTime())) throw new Error("invalid_epdr_time_zone");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === name)!.value;
  return { day: `${part("year")}-${part("month")}-${part("day")}`, hour: Number(part("hour")) };
}
