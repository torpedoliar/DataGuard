'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardCheck, LayoutGrid, ShieldAlert, Server, User } from 'lucide-react';
import clsx from 'clsx';

const TABS = [
  { href: '/checklist', label: 'Audit', icon: ClipboardCheck },
  { href: '/grid', label: 'Grid', icon: LayoutGrid },
  { href: '/admin/siem/findings', label: 'SIEM', icon: ShieldAlert, badge: true },
  { href: '/admin/rack', label: 'Rack', icon: Server },
  { href: '/profile', label: 'Profile', icon: User },
];

export function BottomNav() {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      role="tablist"
      aria-label="Primary"
      className="fixed bottom-0 left-0 z-40 w-full border-t border-ops-border bg-ops-surface-raised pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="mx-auto flex max-w-md justify-around">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = active(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              role="tab"
              aria-current={isActive ? 'page' : undefined}
              className={clsx(
                'relative flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors active:scale-95',
                isActive ? 'text-ops-accent' : 'text-ops-muted',
              )}
            >
              {isActive && (
                <span className="absolute top-0 h-0.5 w-8 rounded-full bg-ops-accent" aria-hidden="true" />
              )}
              <span className="relative">
                <Icon className={clsx('h-6 w-6', isActive && 'font-bold')} strokeWidth={isActive ? 2.5 : 2} />
                {tab.badge && <BadgeDot />}
              </span>
              <span className={isActive ? 'font-semibold' : ''}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// ponytail: static red dot for SIEM. Wire to real open-finding count via
// meta.badgeCounts / useOnlineStatus-style hook when badge polling lands.
function BadgeDot() {
  return (
    <span
      className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-ops-danger ring-2 ring-ops-surface-raised"
      aria-label="unread"
    />
  );
}
