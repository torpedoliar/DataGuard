import clsx from "clsx";
import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={clsx(
        "ops-panel flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="flex size-12 items-center justify-center rounded-full bg-ops-surface text-ops-muted">
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-ops-text">{title}</h3>
      {description ? <p className="max-w-md text-sm text-ops-muted">{description}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

export default EmptyState;
