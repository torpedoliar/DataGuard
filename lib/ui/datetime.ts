const WIB_TIME_ZONE = "Asia/Jakarta";

// Shared SIEM date formatter, pinned to WIB so output is identical
// regardless of the server/browser timezone. seconds:true mirrors the
// places that previously used timeStyle:"medium".
export function formatWibDateTime(date: Date | string, opts?: { seconds?: boolean }) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: opts?.seconds ? "medium" : "short",
    timeZone: WIB_TIME_ZONE,
  }).format(new Date(date));
}

// String form for Telegram alerts, with an explicit WIB suffix.
export function formatWibForAlert(date: Date | string) {
  return `${formatWibDateTime(date)} WIB`;
}
