export type LocalQuietWindow = { quietStart: number | null; quietEnd: number | null };

export function isValidLocalQuietWindow({ quietStart, quietEnd }: LocalQuietWindow): boolean {
  if (quietStart === null && quietEnd === null) return true;
  return typeof quietStart === "number" && typeof quietEnd === "number" &&
    Number.isInteger(quietStart) && Number.isInteger(quietEnd) &&
    quietStart >= 0 && quietStart <= 23 && quietEnd >= 0 && quietEnd <= 23 && quietStart !== quietEnd;
}

/** UTC hours, start inclusive/end exclusive. Never mutates the supplied date. */
export function nextLocalNotificationDelivery(now: Date, window: LocalQuietWindow): Date {
  if (!Number.isFinite(now.getTime()) || !isValidLocalQuietWindow(window)) throw new Error("invalid_local_quiet_window");
  const next = new Date(now);
  const { quietStart, quietEnd } = window;
  if (quietStart === null || quietEnd === null) return next;
  const hour = now.getUTCHours();
  const quiet = quietStart < quietEnd
    ? hour >= quietStart && hour < quietEnd
    : hour >= quietStart || hour < quietEnd;
  if (!quiet) return next;
  next.setUTCHours(quietEnd, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
