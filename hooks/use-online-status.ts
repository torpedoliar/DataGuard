import { useState, useEffect } from 'react';

// null on server + first paint so consumers can render nothing until the
// real value is known client-side (prevents hydration mismatch + banner flash).
export function useOnlineStatus(): boolean | null {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);
  return isOnline;
}
