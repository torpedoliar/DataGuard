/** Refresh local snapshots only; this never starts a provider sync. */
export function scheduleSyncRefresh(refresh: () => void, onStop?: () => void): () => void {
  let remaining = 20;
  const timer = setInterval(() => {
    refresh();
    remaining -= 1;
    if (remaining === 0) {
      clearInterval(timer);
      // The panel uses this to say that polling paused instead of silently
      // leaving an active request looking frozen.
      onStop?.();
    }
  }, 15_000);
  return () => clearInterval(timer);
}
