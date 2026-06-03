import Link from "next/link";
import type { ComponentProps, MouseEventHandler, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import clsx from "clsx";

type ActionButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ActionButtonSize = "sm" | "md" | "icon";

type ActionButtonBaseProps = {
  variant?: ActionButtonVariant;
  size?: ActionButtonSize;
  isPending?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
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
};

const variantClasses: Record<ActionButtonVariant, string> = {
  primary: "border-transparent bg-ops-accent text-slate-950 hover:bg-[#77e3ca] shadow-[0_8px_28px_rgba(93,212,180,0.12)]",
  secondary: "border-ops-border bg-ops-surface-raised text-ops-text hover:border-ops-accent/50 hover:text-white",
  danger: "border-red-500/30 bg-red-500/12 text-red-200 hover:bg-red-500/20",
  ghost: "border-transparent bg-transparent text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text",
};

const sizeClasses: Record<ActionButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
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
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent/40",
    variantClasses[variant],
    sizeClasses[size],
    disabled && "pointer-events-none opacity-55",
    className,
  );
}

export default function ActionButton(props: ActionButtonProps) {
  const {
    href,
    target,
    rel,
    title,
    type = "button",
    disabled: disabledProp,
    onClick,
    formAction,
    variant = "primary",
    size = "md",
    isPending = false,
    icon,
    children,
    className,
  } = props;
  const disabled = isPending || disabledProp;
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
      onClick={onClick as MouseEventHandler<HTMLButtonElement> | undefined}
      formAction={formAction}
      disabled={disabled}
      className={classes}
    >
      {content}
    </button>
  );
}
