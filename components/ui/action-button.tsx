import Link from "next/link";
import type { ComponentProps, MouseEventHandler, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import clsx from "clsx";

type ActionButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "link";
type ActionButtonSize = "sm" | "md" | "icon";

type ActionButtonBaseProps = {
  variant?: ActionButtonVariant;
  size?: ActionButtonSize;
  isPending?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
  "aria-label"?: string;
};

type ActionButtonProps = ActionButtonBaseProps & {
  href?: string;
  target?: string;
  rel?: string;
  title?: string;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement | HTMLAnchorElement>;
  formAction?: ComponentProps<"button">["formAction"];
  "aria-label"?: string;
  "aria-pressed"?: boolean;
};

export const actionButtonVariantClasses: Record<ActionButtonVariant, string> = {
  primary:
    "border-transparent bg-ops-accent text-ops-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(0_0_0/0.12)] hover:bg-ops-accent-hover",
  secondary:
    "border-ops-border-strong bg-ops-surface text-ops-text shadow-[0_1px_2px_rgb(0_0_0/0.04)] hover:bg-ops-surface-raised hover:border-ops-subtle/60",
  danger: "border-ops-danger/25 bg-ops-danger-soft text-ops-danger hover:border-ops-danger/45 hover:bg-ops-danger/15",
  ghost: "border-transparent bg-transparent text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text",
  link: "h-auto border-transparent bg-transparent px-0 text-ops-accent underline-offset-4 hover:underline",
};

const sizeClasses: Record<ActionButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-3.5 text-sm",
  icon: "size-9 justify-center p-0",
};

function actionButtonClassName({
  variant = "primary",
  size = "md",
  className,
  disabled,
}: {
  variant?: ActionButtonVariant;
  size?: ActionButtonSize;
  className?: string;
  disabled?: boolean;
}) {
  return clsx(
    "inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-md border font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ops-accent/30 [&_svg]:size-4 [&_svg]:shrink-0",
    actionButtonVariantClasses[variant],
    sizeClasses[size],
    disabled && "pointer-events-none opacity-55",
    className,
  );
}

export default function ActionButton(props: ActionButtonProps) {
  const { href, target, rel, title, type = "button", disabled: disabledProp, onClick, formAction, variant = "primary", size = "md", isPending = false, icon, children, className } = props;
  const disabled = isPending || disabledProp;
  // Icon-only buttons (size === "icon" and no visible text) MUST have an
  // accessible name. Prefer an explicit `aria-label`; fall back to the `title`
  // hint, which the caller is already required to provide.
  const isIconOnly = size === "icon" && children === undefined;
  const ariaLabel = isIconOnly ? (props["aria-label"] ?? title) : props["aria-label"];
  const content = (
    <>
      {isPending ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </>
  );
  const classes = actionButtonClassName({ variant, size, className, disabled });

  if (href) {
    return (
      <Link
        href={href}
        target={target}
        rel={rel}
        title={title}
        aria-label={ariaLabel}
        onClick={onClick as MouseEventHandler<HTMLAnchorElement> | undefined}
        aria-disabled={disabled || undefined}
        className={classes}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type={type}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={props["aria-pressed"]}
      onClick={onClick as MouseEventHandler<HTMLButtonElement> | undefined}
      formAction={formAction}
      disabled={disabled}
      className={classes}
    >
      {content}
    </button>
  );
}
