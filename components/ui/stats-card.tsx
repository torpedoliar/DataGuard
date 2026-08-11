import type { ReactNode } from "react";
import clsx from "clsx";
import type { UiTone } from "@/lib/ui/status";

const iconToneClasses: Record<UiTone, string> = {
  neutral: "bg-slate-400/15 text-slate-500 dark:bg-slate-500/12 dark:text-slate-300",
  success: "bg-emerald-500/15 text-emerald-500 dark:bg-emerald-400/12 dark:text-emerald-200",
  warning: "bg-amber-500/15 text-amber-500 dark:bg-amber-400/12 dark:text-amber-200",
  orange: "bg-orange-500/15 text-orange-500 dark:bg-orange-400/12 dark:text-orange-200",
  danger: "bg-red-500/15 text-red-500 dark:bg-red-400/12 dark:text-red-200",
  info: "bg-blue-500/15 text-blue-500 dark:bg-blue-400/12 dark:text-blue-200",
  accent: "bg-ops-accent/12 text-ops-accent",
  purple: "bg-purple-500/15 text-purple-500 dark:bg-purple-400/12 dark:text-purple-200",
};

export default function StatsCard({
  label,
  value,
  meta,
  icon,
  tone = "neutral",
  className,
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  tone?: UiTone;
  className?: string;
}) {
  return (
    <div className={clsx("ops-panel p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted">{label}</p>
          <div className="mt-2 text-3xl font-bold leading-none tracking-normal text-ops-text">{value}</div>
        </div>
        {icon && (
          <div className={clsx("flex size-9 shrink-0 items-center justify-center rounded-md", iconToneClasses[tone])}>
            {icon}
          </div>
        )}
      </div>
      {meta && <div className="mt-3 text-xs text-ops-muted">{meta}</div>}
    </div>
  );
}
