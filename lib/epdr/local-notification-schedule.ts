import { epdrLocalClock, isValidEpdrTimeZone } from "./time-zone";

export type LocalQuietWindow = { quietStart: number | null; quietEnd: number | null; timeZone?: string };

export function isValidLocalQuietWindow({ quietStart, quietEnd }: LocalQuietWindow): boolean {
  if (quietStart === null && quietEnd === null) return true;
  return typeof quietStart === "number" && typeof quietEnd === "number" &&
    Number.isInteger(quietStart) && Number.isInteger(quietEnd) &&
    quietStart >= 0 && quietStart <= 23 && quietEnd >= 0 && quietEnd <= 23 && quietStart !== quietEnd;
}

/** Local wall-clock hours, start inclusive/end exclusive. UTC preserves legacy semantics.
 * Walk real minutes rather than constructing ambiguous/nonexistent DST wall times.
 * At most two local days are needed, including skipped/repeated hours.
 */
export function nextLocalNotificationDelivery(now: Date, window: LocalQuietWindow): Date {
  const timeZone = window.timeZone ?? "UTC";
  if (!Number.isFinite(now.getTime()) || !isValidLocalQuietWindow(window) || !isValidEpdrTimeZone(timeZone)) {
    throw new Error("invalid_local_quiet_window");
  }
  const { quietStart, quietEnd } = window;
  if (quietStart === null || quietEnd === null) return new Date(now);
  const isQuiet = (date: Date) => {
    const { hour } = epdrLocalClock(date, timeZone);
    return quietStart < quietEnd ? hour >= quietStart && hour < quietEnd : hour >= quietStart || hour < quietEnd;
  };
  if (!isQuiet(now)) return new Date(now);
  let next = Math.floor(now.getTime() / 60000) * 60000 + 60000;
  for (let minutes = 0; minutes < 48 * 60; minutes++, next += 60000) {
    const date = new Date(next);
    if (!isQuiet(date)) return date;
  }
  throw new Error("invalid_local_quiet_window");
}
