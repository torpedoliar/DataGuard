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
        "ops-panel flex animate-enter flex-col items-center justify-center gap-2 px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mb-1 flex size-10 items-center justify-center rounded-lg border border-ops-border bg-ops-surface-raised text-ops-muted [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <h3 className="text-[15px] font-semibold text-ops-text">{title}</h3>
      {description ? <p className="max-w-md text-sm text-ops-muted">{description}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

export default EmptyState;
