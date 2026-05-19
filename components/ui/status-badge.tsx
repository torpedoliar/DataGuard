import type { ReactNode } from "react";
import clsx from "clsx";
import type { UiTone } from "@/lib/ui/status";

const toneClasses: Record<UiTone, string> = {
  neutral: "border-slate-500/25 bg-slate-500/12 text-slate-300",
  success: "border-emerald-400/25 bg-emerald-400/12 text-emerald-200",
  warning: "border-amber-400/30 bg-amber-400/12 text-amber-200",
  orange: "border-orange-400/30 bg-orange-400/12 text-orange-200",
  danger: "border-red-400/30 bg-red-400/12 text-red-200",
  info: "border-blue-400/30 bg-blue-400/12 text-blue-200",
  accent: "border-ops-accent/30 bg-ops-accent/12 text-[#b7f5e4]",
  purple: "border-purple-400/30 bg-purple-400/12 text-purple-200",
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
