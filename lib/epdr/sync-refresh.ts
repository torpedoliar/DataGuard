/** Refresh local snapshots only; this never starts a provider sync. */
export function scheduleSyncRefresh(refresh: () => void): () => void {
  let remaining = 20;
  const timer = setInterval(() => {
    refresh();
    remaining -= 1;
    if (remaining === 0) clearInterval(timer);
  }, 15_000);
  return () => clearInterval(timer);
}
