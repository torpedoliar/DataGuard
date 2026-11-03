import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export default function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  // "Admin / Inventory" style eyebrows render as a quiet breadcrumb trail.
  const crumbs = eyebrow ? eyebrow.split("/").map((part) => part.trim()).filter(Boolean) : [];

  return (
    <div className="flex animate-enter flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {crumbs.length > 0 && (
          <p className="mb-1.5 flex items-center gap-1 text-[13px] text-ops-muted">
            {crumbs.map((crumb, index) => (
              <span key={`${crumb}-${index}`} className="flex items-center gap-1">
                {index > 0 && <ChevronRight className="size-3.5 text-ops-subtle" aria-hidden />}
                <span className={index === crumbs.length - 1 ? "text-ops-text/80" : undefined}>{crumb}</span>
              </span>
            ))}
          </p>
        )}
        <h1 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ops-text sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-ops-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
