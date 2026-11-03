"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import type { ReactNode } from "react";

export type SubNavItem = {
  href: string;
  label: string;
  icon?: ReactNode;
  /** Match only the exact path (for index routes like /admin/siem). */
  exact?: boolean;
};

/**
 * Underlined tab strip for sibling routes inside one feature area
 * (SIEM, NCM, admin inventory). Active state is derived from the pathname,
 * so it works with locale-prefixed URLs too.
 */
export default function SubNav({ items, className, label = "Section" }: { items: SubNavItem[]; className?: string; label?: string }) {
  const pathname = usePathname();
  const path = pathname.replace(/^\/(en|id)(?=\/|$)/, "") || "/";

  const isActive = (item: SubNavItem) =>
    item.exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);

  return (
    <nav aria-label={label} className={clsx("-mx-1 overflow-x-auto border-b border-ops-border", className)}>
      <ul className="flex min-w-max items-center gap-1 px-1">
        {items.map((item) => {
          const active = isActive(item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "relative flex h-10 items-center gap-2 rounded-t-md px-3 text-[13px] font-medium transition-colors [&_svg]:size-4",
                  active ? "text-ops-text" : "text-ops-muted hover:text-ops-text",
                )}
              >
                {item.icon}
                {item.label}
                <span
                  aria-hidden
                  className={clsx(
                    "absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-ops-accent transition-opacity duration-200",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
