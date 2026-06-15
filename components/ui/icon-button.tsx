"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

/**
 * Icon-only button with required aria-label. Replaces ad-hoc
 * `<button><X className="..." /></button>` patterns.
 *
 * The label is rendered as a visually hidden `span` so screen readers and
 * sighted keyboard users both get a discoverable name. The visible icon must
 * be marked `aria-hidden` by callers, since the label is the accessible name.
 */
export type IconButtonProps = {
  icon: ReactNode;
  label: string;
  variant?: "ghost" | "primary" | "secondary" | "danger";
  size?: "sm" | "md" | "icon";
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children">;

const variantClasses: Record<NonNullable<IconButtonProps["variant"]>, string> = {
  primary: "border-transparent bg-ops-accent text-slate-950 hover:bg-[#77e3ca]",
  secondary: "border-ops-border bg-ops-surface-raised text-ops-text hover:border-ops-accent/50 hover:text-white",
  danger: "border-red-500/30 bg-red-500/12 text-red-200 hover:bg-red-500/20",
  ghost: "border-transparent bg-transparent text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text",
};

const sizeClasses: Record<NonNullable<IconButtonProps["size"]>, string> = {
  sm: "size-8 p-0",
  md: "size-9 p-0",
  icon: "size-9 p-0",
};

export function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "icon",
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent/40 disabled:pointer-events-none disabled:opacity-55",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {icon}
      <span className="sr-only">{label}</span>
    </button>
  );
}

export default IconButton;
