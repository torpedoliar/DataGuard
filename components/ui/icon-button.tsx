"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";
import { actionButtonVariantClasses } from "@/components/ui/action-button";

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
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ops-accent/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
        actionButtonVariantClasses[variant],
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
