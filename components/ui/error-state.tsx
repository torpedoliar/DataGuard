import clsx from "clsx";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  icon,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={clsx(
        "ops-panel flex animate-enter flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="mb-1 flex size-10 items-center justify-center rounded-lg border border-ops-danger/25 bg-ops-danger-soft text-ops-danger [&_svg]:size-5">
        {icon ?? <AlertTriangle className="size-6" aria-hidden="true" />}
      </div>
      <h3 className="text-[15px] font-semibold text-ops-text">{title}</h3>
      {description ? <p className="max-w-md text-sm text-ops-muted">{description}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

export default ErrorState;
