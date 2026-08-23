'use client';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';

export function OfflineBanner() {
  // useOnlineStatus returns true on SSR/first paint (assumed online), so the
  // banner only appears after the client actually observes an offline event.
  const isOnline = useOnlineStatus();
  const [dismissed, setDismissed] = useState(false);

  if (isOnline || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex items-center justify-between gap-2 border-b border-ops-border bg-ops-surface-raised p-2 text-ops-warning"
    >
      <div className="flex min-w-0 items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="truncate text-sm">Offline — network disconnected</span>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss offline banner"
        className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-ops-muted hover:bg-ops-surface hover:text-ops-text active:scale-95"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
