"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Boxes,
  Building2,
  ChartColumn,
  ChevronDown,
  CircleAlert,
  ClipboardCheck,
  Download,
  FolderTree,
  Grid3X3,
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Network,
  PanelTop,
  QrCode,
  Search,
  Server,
  Settings,
  ShieldAlert,
  Tag,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { logout, switchSite } from "@/actions/auth";
import { getAppNavigation, type NavItem } from "@/lib/ui/navigation";
import ActionButton from "@/components/ui/action-button";

type SiteInfo = { id: number; name: string; code: string };

type AppShellProps = {
  user: { username: string; role: string; photoPath?: string | null };
  activeSite: { id: number | null; name: string | null };
  userSites: SiteInfo[];
  appSettings: { appName: string; logoPath: string | null };
  children: React.ReactNode;
};

const iconMap: Record<string, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  "clipboard-check": ClipboardCheck,
  "qr-code": QrCode,
  "grid-3x3": Grid3X3,
  "circle-alert": CircleAlert,
  "chart-column": ChartColumn,
  server: Server,
  boxes: Boxes,
  "panel-top": PanelTop,
  network: Network,
  tag: Tag,
  "folder-tree": FolderTree,
  "map-pin": MapPin,
  history: History,
  users: Users,
  "building-2": Building2,
  settings: Settings,
  "shield-alert": ShieldAlert,
  download: Download,
};

function getInitials(username: string) {
  return username.slice(0, 2).toUpperCase();
}

export default function AppShell({
  user,
  activeSite,
  userSites,
  appSettings,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const navigation = getAppNavigation(user.role);

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const handleSwitchSite = (siteId: number) => {
    startTransition(async () => {
      await switchSite(siteId);
      setSiteOpen(false);
      window.location.reload();
    });
  };

  const rail = (
    <aside className="flex h-full min-h-0 flex-col border-r border-ops-border bg-ops-surface px-4 py-5">
      <Link href="/select-site" className="mb-5 flex min-w-0 items-center gap-3 px-2">
        {appSettings.logoPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={appSettings.logoPath} alt={appSettings.appName} className="h-8 w-8 shrink-0 object-contain" />
        ) : (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-ops-accent text-slate-950">
            <Server className="size-4" />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ops-text">{appSettings.appName}</p>
          <p className="text-[11px] font-medium text-ops-muted">Data center audit</p>
        </div>
      </Link>

      <button
        type="button"
        onClick={() => setSiteOpen((value) => !value)}
        disabled={isPending || userSites.length <= 1}
        className="relative mb-5 rounded-md border border-ops-border bg-ops-surface-raised p-3 text-left transition-colors hover:border-ops-accent/45 disabled:cursor-default"
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-ops-muted">Active Site</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-ops-text">{activeSite.name || "No site selected"}</span>
          {userSites.length > 1 && <ChevronDown className="size-4 shrink-0 text-ops-muted" />}
        </div>
      </button>

      {siteOpen && userSites.length > 1 && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" type="button" onClick={() => setSiteOpen(false)} />
          <div className="absolute left-5 top-[104px] z-50 w-64 overflow-hidden rounded-md border border-ops-border bg-ops-surface-raised shadow-2xl">
            <div className="border-b border-ops-border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ops-muted">
              Switch Site
            </div>
            <div className="max-h-64 overflow-y-auto p-1.5">
              {userSites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => handleSwitchSite(site.id)}
                  disabled={isPending || site.id === activeSite.id}
                  className={clsx(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                    site.id === activeSite.id
                      ? "bg-ops-accent/12 text-[#b7f5e4]"
                      : "text-slate-300 hover:bg-ops-surface hover:text-white",
                  )}
                >
                  <span className={clsx("size-1.5 rounded-full", site.id === activeSite.id ? "bg-ops-accent" : "bg-slate-600")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{site.name}</span>
                    <span className="block font-mono text-[10px] text-ops-muted">{site.code}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1.5">
        {navigation.map((group) => (
          <div key={group.label}>
            <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ops-muted">{group.label}</p>
            <div className="space-y-1">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(item.href)} onNavigate={() => setMobileOpen(false)} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-4 border-t border-ops-border pt-3">
        <Link
          href="/profile"
          className="flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-ops-muted transition-colors hover:bg-ops-surface-raised hover:text-ops-text"
        >
          <User className="size-4" />
          Profile
        </Link>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-ops-bg text-ops-text">
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:block lg:w-[17rem]">{rail}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close navigation overlay" className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-[min(20rem,88vw)]">{rail}</div>
        </div>
      )}

      <div className="min-h-screen lg:pl-[17rem]">
        <header className="sticky top-0 z-30 border-b border-ops-border bg-ops-bg/94 backdrop-blur-xl">
          <div className="flex h-14 items-center justify-between gap-3 px-4 lg:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="flex size-9 items-center justify-center rounded-md border border-ops-border bg-ops-surface text-ops-muted lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="size-4" />
              </button>

              <div className="hidden min-w-0 items-center gap-2 rounded-md border border-ops-border bg-ops-surface px-3 py-1.5 text-sm text-ops-muted md:flex">
                <Search className="size-4" />
                <input
                  type="search"
                  placeholder="Search device or incident..."
                  className="w-56 bg-transparent text-sm text-ops-text outline-none placeholder:text-ops-muted"
                />
              </div>

              <div className="hidden items-center gap-2 text-xs text-ops-muted xl:flex">
                <span className="rounded-full border border-ops-border px-2.5 py-1">{activeSite.name || "No active site"}</span>
                <span>{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <ActionButton href="/audit/new" size="sm" icon={<ClipboardCheck className="size-4" />}>
                <span className="hidden sm:inline">New Audit</span>
              </ActionButton>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setUserOpen((value) => !value)}
                  className="flex size-9 items-center justify-center overflow-hidden rounded-full border border-ops-border bg-ops-surface-raised text-xs font-bold text-ops-text transition-colors hover:border-ops-accent/50"
                  title={user.username}
                >
                  {user.photoPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.photoPath} alt={user.username} className="h-full w-full object-cover" />
                  ) : (
                    getInitials(user.username)
                  )}
                </button>

                {userOpen && (
                  <>
                    <button className="fixed inset-0 z-40 cursor-default" type="button" onClick={() => setUserOpen(false)} />
                    <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-md border border-ops-border bg-ops-surface-raised shadow-2xl">
                      <div className="border-b border-ops-border px-4 py-3">
                        <p className="truncate text-sm font-semibold text-ops-text">{user.username}</p>
                        <p className="text-xs capitalize text-ops-muted">{user.role}</p>
                      </div>
                      <Link
                        href="/profile"
                        onClick={() => setUserOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:bg-ops-surface hover:text-white"
                      >
                        <User className="size-4" />
                        Profile Settings
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setUserOpen(false);
                          logout();
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-300 hover:bg-red-500/10"
                      >
                        <LogOut className="size-4" />
                        Log Out
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="min-h-[calc(100vh-56px)]">{children}</div>
      </div>
    </div>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: () => void;
}) {
  const Icon = iconMap[item.icon] || Server;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={clsx(
        "flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors",
        active
          ? "border border-ops-accent/30 bg-ops-accent/12 text-[#b7f5e4]"
          : "text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}
