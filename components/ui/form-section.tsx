import type { ReactNode } from "react";
import clsx from "clsx";

export default function FormSection({
  title,
  description,
  children,
  footer,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("ops-panel overflow-hidden", className)}>
      {(title || description) && (
        <div className="border-b border-ops-border bg-ops-surface px-5 py-4">
          {title && <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">{title}</h2>}
          {description && <p className="mt-1 text-sm text-ops-muted">{description}</p>}
        </div>
      )}
      <div className="p-5">{children}</div>
      {footer && <div className="flex items-center justify-end gap-2 border-t border-ops-border bg-ops-surface-raised px-5 py-3">{footer}</div>}
    </section>
  );
}
