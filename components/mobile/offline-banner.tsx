'use client';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';

export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const [dismissed, setDismissed] = useState(false);
  
  if (isOnline || dismissed) return null;
  return (
    <div className="sticky top-0 z-50 flex items-center justify-between bg-ops-surface-raised p-2 text-ops-warning border-b border-ops-border">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        <span className="text-sm">Offline — network disconnected</span>
      </div>
      <button onClick={() => setDismissed(true)}><X className="h-4 w-4" /></button>
    </div>
  );
}
