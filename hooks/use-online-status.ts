import { useSyncExternalStore } from 'react';

// Server snapshot is `true` so the offline banner stays hidden during SSR and
// first paint — the same no-flash guarantee the old null-based hook gave,
// without an effect. The store API re-reads navigator.onLine on every
// online/offline event, no state needed.
function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
