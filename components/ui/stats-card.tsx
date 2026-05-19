import type { ReactNode } from "react";
import clsx from "clsx";
import type { UiTone } from "@/lib/ui/status";

const iconToneClasses: Record<UiTone, string> = {
  neutral: "bg-slate-500/12 text-slate-300",
  success: "bg-emerald-400/12 text-emerald-200",
  warning: "bg-amber-400/12 text-amber-200",
  orange: "bg-orange-400/12 text-orange-200",
  danger: "bg-red-400/12 text-red-200",
  info: "bg-blue-400/12 text-blue-200",
  accent: "bg-ops-accent/12 text-[#b7f5e4]",
  purple: "bg-purple-400/12 text-purple-200",
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
