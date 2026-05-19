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
    <thead className="border-b border-ops-border bg-ops-surface text-[11px] font-semibold uppercase tracking-[0.08em] text-ops-muted">
      {children}
    </thead>
  );
}

export function DataTableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-ops-border/55 bg-ops-bg/30">{children}</tbody>;
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
      <td colSpan={colSpan} className="px-4 py-10 text-center">
        <p className="text-sm font-semibold text-ops-text">{title}</p>
        {description && <p className="mt-1 text-sm text-ops-muted">{description}</p>}
      </td>
    </tr>
  );
}
