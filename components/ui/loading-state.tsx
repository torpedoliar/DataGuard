import clsx from "clsx";
import { Loader2 } from "lucide-react";

export function LoadingState({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "ops-panel flex flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        className,
      )}
    >
      <Loader2 className="size-6 animate-spin text-ops-muted" aria-hidden="true" />
      <p className="text-sm text-ops-muted">{label}</p>
    </div>
  );
}

export default LoadingState;
