import type { ReactNode, TableHTMLAttributes } from "react";
import clsx from "clsx";

export function DataTableFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={clsx("ops-panel overflow-hidden", className)}>{children}</div>;
}

export function DataTable({
  children,
  className,
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table {...props} className={clsx("min-w-full text-left text-sm", className)}>
        {children}
      </table>
    </div>
  );
}

export function DataTableHead({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-[1] border-b border-ops-border bg-ops-surface-raised text-xs font-medium text-ops-muted [&_th]:h-9 [&_th]:whitespace-nowrap">
      {children}
    </thead>
  );
}

export function DataTableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-ops-border bg-ops-surface [&>tr:hover]:bg-ops-surface-raised/60">{children}</tbody>;
}

export function DataTableEmpty({
  colSpan,
  title,
  description,
}: {
  colSpan: number;
  title: string;
  description?: string;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-14 text-center">
        <p className="text-sm font-medium text-ops-text">{title}</p>
        {description && <p className="mt-1 text-sm text-ops-muted">{description}</p>}
      </td>
    </tr>
  );
}
