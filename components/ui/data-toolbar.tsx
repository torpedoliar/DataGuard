import type { ReactNode } from "react";
import clsx from "clsx";

export default function DataToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "ops-panel flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between",
        className,
      )}
    >
      {children}
    </div>
  );
}
