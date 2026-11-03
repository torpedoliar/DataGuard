import type { ReactNode } from "react";
import clsx from "clsx";
import type { UiTone } from "@/lib/ui/status";

const iconToneClasses: Record<UiTone, string> = {
  neutral: "bg-ops-surface-raised text-ops-muted",
  success: "bg-ops-success-soft text-ops-success",
  warning: "bg-ops-warning-soft text-ops-warning",
  orange: "bg-ops-orange-soft text-ops-orange",
  danger: "bg-ops-danger-soft text-ops-danger",
  info: "bg-ops-info-soft text-ops-info",
  accent: "bg-ops-accent-soft text-ops-accent",
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
          <p className="text-[13px] font-medium text-ops-muted">{label}</p>
          <div className="mt-2 text-[28px] font-semibold leading-none tracking-[-0.02em] text-ops-text tabular-nums">{value}</div>
        </div>
        {icon && (
          <div className={clsx("flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4", iconToneClasses[tone])}>
            {icon}
          </div>
        )}
      </div>
      {meta && <div className="mt-3 text-xs text-ops-muted">{meta}</div>}
    </div>
  );
}
