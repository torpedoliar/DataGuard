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
        "ops-panel flex flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-red-500/15 text-red-300">
        {icon ?? <AlertTriangle className="size-6" aria-hidden="true" />}
      </div>
      <h3 className="text-base font-semibold text-ops-text">{title}</h3>
      {description ? <p className="max-w-md text-sm text-ops-muted">{description}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

export default ErrorState;
