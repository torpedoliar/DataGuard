import type { ReactNode } from "react";
import clsx from "clsx";
import type { UiTone } from "@/lib/ui/status";

const toneClasses: Record<UiTone, string> = {
  neutral: "border-slate-400/40 bg-slate-400/15 text-slate-600 dark:border-slate-500/25 dark:bg-slate-500/12 dark:text-slate-300",
  success: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:border-emerald-400/25 dark:bg-emerald-400/12 dark:text-emerald-200",
  warning: "border-amber-500/40 bg-amber-500/15 text-amber-600 dark:border-amber-400/30 dark:bg-amber-400/12 dark:text-amber-200",
  orange: "border-orange-500/40 bg-orange-500/15 text-orange-600 dark:border-orange-400/30 dark:bg-orange-400/12 dark:text-orange-200",
  danger: "border-red-500/40 bg-red-500/15 text-red-600 dark:border-red-400/30 dark:bg-red-400/12 dark:text-red-200",
  info: "border-blue-500/40 bg-blue-500/15 text-blue-600 dark:border-blue-400/30 dark:bg-blue-400/12 dark:text-blue-200",
  accent: "border-ops-accent/30 bg-ops-accent/12 text-ops-accent dark:border-ops-accent/30 dark:bg-ops-accent/12 dark:text-ops-accent",
  purple: "border-purple-500/40 bg-purple-500/15 text-purple-600 dark:border-purple-400/30 dark:bg-purple-400/12 dark:text-purple-200",
};

const dotClasses: Record<UiTone, string> = {
  neutral: "bg-slate-400",
  success: "bg-emerald-400",
  warning: "bg-amber-400",
  orange: "bg-orange-400",
  danger: "bg-red-400",
  info: "bg-blue-400",
  accent: "bg-ops-accent",
  purple: "bg-purple-400",
};

export default function StatusBadge({
  tone = "neutral",
  dot = false,
  children,
  className,
}: {
  tone?: UiTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none",
        toneClasses[tone],
        className,
      )}
    >
      {dot && <span className={clsx("size-1.5 rounded-full", dotClasses[tone])} />}
      {children}
    </span>
  );
}
