"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { scheduleSyncRefresh } from "@/lib/epdr/sync-refresh";

export default function SyncRefresh({ waiting }: { waiting: boolean }) {
  const router = useRouter();
  const t = useTranslations("Epdr");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!waiting) return;
    return scheduleSyncRefresh(() => router.refresh());
  }, [waiting, router]);

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-ops-muted">
      <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}
        className="rounded-md border border-ops-border px-3 py-2 text-sm text-ops-text disabled:opacity-50">
        {t("setup.refresh")}
      </button>
      {waiting && <span>{t("setup.refreshHint")}</span>}
    </div>
  );
}
