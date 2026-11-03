import type { ReactNode } from "react";
import clsx from "clsx";
import type { UiTone } from "@/lib/ui/status";

const toneClasses: Record<UiTone, string> = {
  neutral: "border-ops-border-strong bg-ops-surface-raised text-ops-muted",
  success: "border-ops-success/25 bg-ops-success-soft text-ops-success",
  warning: "border-ops-warning/25 bg-ops-warning-soft text-ops-warning",
  orange: "border-ops-orange/25 bg-ops-orange-soft text-ops-orange",
  danger: "border-ops-danger/25 bg-ops-danger-soft text-ops-danger",
  info: "border-ops-info/25 bg-ops-info-soft text-ops-info",
  accent: "border-ops-accent/25 bg-ops-accent-soft text-ops-accent",
};

const dotClasses: Record<UiTone, string> = {
  neutral: "bg-ops-subtle",
  success: "bg-ops-success",
  warning: "bg-ops-warning",
  orange: "bg-ops-orange",
  danger: "bg-ops-danger",
  info: "bg-ops-info",
  accent: "bg-ops-accent",
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
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 text-xs font-medium leading-none",
        toneClasses[tone],
        className,
      )}
    >
      {dot && <span className={clsx("size-1.5 shrink-0 rounded-full", dotClasses[tone])} />}
      {children}
    </span>
  );
}
