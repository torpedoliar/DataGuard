import Link from 'next/link';
import { ClipboardCheck, LayoutGrid, ShieldAlert, Server, User } from 'lucide-react';

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 w-full bg-ops-surface-raised border-t border-ops-border flex justify-around pb-[env(safe-area-inset-bottom)] md:hidden">
      <Link href="/checklist" className="flex flex-col items-center p-2 text-ops-muted active:scale-95 active:opacity-80">
        <ClipboardCheck className="h-6 w-6" />
        <span className="text-xs">Audit</span>
      </Link>
      <Link href="/grid" className="flex flex-col items-center p-2 text-ops-muted active:scale-95 active:opacity-80">
        <LayoutGrid className="h-6 w-6" />
        <span className="text-xs">Grid</span>
      </Link>
      <Link href="/admin/siem/findings" className="flex flex-col items-center p-2 text-ops-muted active:scale-95 active:opacity-80">
        <ShieldAlert className="h-6 w-6" />
        <span className="text-xs">SIEM</span>
      </Link>
      <Link href="/admin/rack" className="flex flex-col items-center p-2 text-ops-muted active:scale-95 active:opacity-80">
        <Server className="h-6 w-6" />
        <span className="text-xs">Rack</span>
      </Link>
      <Link href="#" className="flex flex-col items-center p-2 text-ops-muted active:scale-95 active:opacity-80">
        <User className="h-6 w-6" />
        <span className="text-xs">Profile</span>
      </Link>
    </nav>
  );
}
