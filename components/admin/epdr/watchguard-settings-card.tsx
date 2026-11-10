import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronRight, PlugZap } from "lucide-react";
import clsx from "clsx";
import type { WatchGuardSettingsData } from "@/actions/watchguard-settings";

/**
 * One-line summary on the main Settings page; the actual per-site setup lives
 * on its own page so a long wizard never crowds the general settings list.
 */
export default async function WatchGuardSettingsCard({ data }: { data: WatchGuardSettingsData }) {
  const t = await getTranslations("Epdr");
  const connected = data.sites.filter((s) => s.configured && s.enabled).length;
  const paused = data.sites.filter((s) => s.configured && !s.enabled).length;
  const missing = data.sites.length - connected - paused;

  const parts = [
    connected > 0 ? `${connected} ${t("settings.configured").toLowerCase()}` : null,
    paused > 0 ? `${paused} ${t("settings.paused").toLowerCase()}` : null,
    missing > 0 ? `${missing} ${t("settings.notConfigured").toLowerCase()}` : null,
  ].filter(Boolean);

  return (
    <section className="ops-panel flex flex-wrap items-center gap-4 p-5">
      <span
        className={clsx(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          connected > 0 ? "bg-ops-success-soft text-ops-success" : "bg-ops-surface-raised text-ops-muted",
        )}
      >
        <PlugZap className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold text-ops-text">{t("settings.title")}</h2>
        <p className="mt-0.5 text-[13px] text-ops-muted">
          {parts.length > 0 ? parts.join(" · ") : t("settings.siteListHint")}
        </p>
      </div>
      <Link
        href="/admin/settings/watchguard"
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-ops-border-strong bg-ops-surface px-3.5 py-2 text-sm font-medium text-ops-text transition-colors hover:bg-ops-surface-raised"
      >
        {t("settings.manage")}
        <ChevronRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}
