"use client";

import { useEffect, useState } from "react";
import { GitCompareArrows, WifiOff } from "lucide-react";
import { getNcmFleetBadge } from "@/actions/ncm-fleet-badge";

// ==================== Aggregate nav badge (ticket 10) ====================
// Sits next to the NCM Fleet nav item: one red dot for offline sites, one
// amber count for open drifts. Polled client-side (60s) so the shell stays a
// server component — same trade-off as ThemeToggle being the only client
// island. Renders nothing while loading or when the user lacks access.

export default function NcmFleetNavBadge() {
  const [badge, setBadge] = useState<{ offlineSites: number; openDrifts: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await getNcmFleetBadge();
        if (alive) setBadge(data);
      } catch {
        if (alive) setBadge({ offlineSites: 0, openDrifts: 0 });
      }
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!badge || (badge.offlineSites === 0 && badge.openDrifts === 0)) return null;

  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {badge.offlineSites > 0 && (
        <span
          title={`${badge.offlineSites} site NCM offline`}
          aria-label={`${badge.offlineSites} site NCM offline`}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500/15 px-1.5 text-[10px] font-bold text-red-500 dark:text-red-300"
        >
          <WifiOff className="size-3" />
          {badge.offlineSites}
        </span>
      )}
      {badge.openDrifts > 0 && (
        <span
          title={`${badge.openDrifts} drift terbuka`}
          aria-label={`${badge.openDrifts} drift terbuka`}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-300"
        >
          <GitCompareArrows className="size-3" />
          {badge.openDrifts}
        </span>
      )}
    </span>
  );
}
