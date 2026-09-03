"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { routing } from "@/i18n/routing";
import {
  Boxes,
  Bell,
  Building2,
  Cable,
  CalendarClock,
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
  Mail,
  MapPin,
  Menu,
  Network,
  PanelTop,
  QrCode,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Tag,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { logout, switchSite } from "@/actions/auth";
import { getAppNavigation, type NavGroup, type NavItem } from "@/lib/ui/navigation";
import ActionButton from "@/components/ui/action-button";
import { ThemeToggle } from "@/components/ui/theme-toggle";

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
  cable: Cable,
  tag: Tag,
  "folder-tree": FolderTree,
  "map-pin": MapPin,
  history: History,
  mail: Mail,
  users: Users,
  "building-2": Building2,
  settings: Settings,
  "shield-alert": ShieldAlert,
  "shield-check": ShieldCheck,
  download: Download,
  "calendar-clock": CalendarClock,
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
  const router = useRouter();
  const locale = useLocale();
  const tNav = useTranslations("Nav");
  const tAdmin = useTranslations("AdminMenu");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const navigation = getAppNavigation(user.role);

  const itemLabel = (item: NavItem) =>
    item.labelKey ? (item.ns === "AdminMenu" ? tAdmin(item.labelKey) : tNav(item.labelKey)) : item.label;

  const groupLabel = (group: NavGroup) => (group.labelKey ? tNav(group.labelKey) : group.label);

  // Locale switcher: with localePrefix "as-needed" only the non-default
  // locale ("en") is URL-prefixed. Strip any prefix, then re-apply the
  // target prefix when it is not the default, preserving the current query.
  const switchLocale = (nextLocale: (typeof routing.locales)[number]) => {
    if (nextLocale === locale) return;
    let nextPath = pathname;
    for (const loc of routing.locales) {
      if (nextPath === `/${loc}` || nextPath.startsWith(`/${loc}/`)) {
        nextPath = nextPath.slice(loc.length + 1) || "/";
        break;
      }
    }
    if (nextLocale !== routing.defaultLocale) {
      nextPath = nextPath === "/" ? `/${nextLocale}` : `/${nextLocale}${nextPath}`;
    }
    const search = typeof window !== "undefined" ? window.location.search : "";
    router.push(`${nextPath}${search}`);
  };
  const otherLocale = routing.locales.find((loc) => loc !== locale) ?? routing.defaultLocale;

  // ESC closes any open shell menu (site switcher, user menu, mobile nav),
  // mirroring the dismissal contract of the Modal primitive.
  useEffect(() => {
    if (!siteOpen && !userOpen && !mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSiteOpen(false);
      setUserOpen(false);
      setMobileOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [siteOpen, userOpen, mobileOpen]);

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
          <p className="text-[11px] font-medium text-ops-muted">{tNav("subtitle")}</p>
        </div>
      </Link>

      <button
        type="button"
        onClick={() => setSiteOpen((value) => !value)}
        disabled={isPending || userSites.length <= 1}
        aria-haspopup="listbox"
        aria-expanded={siteOpen}
        aria-controls="site-switcher-menu"
        className="relative mb-5 rounded-md border border-ops-border bg-ops-surface-raised p-3 text-left transition-colors hover:border-ops-accent/45 disabled:cursor-default"
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-ops-muted">{tNav("activeSite")}</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-ops-text">{activeSite.name || tNav("noSiteSelected")}</span>
          {userSites.length > 1 && <ChevronDown className="size-4 shrink-0 text-ops-muted" />}
        </div>
      </button>

      {siteOpen && userSites.length > 1 && (
        <>
          <div role="presentation" className="fixed inset-0 z-40" onClick={() => setSiteOpen(false)} />
          <div id="site-switcher-menu" className="absolute left-5 top-[104px] z-50 w-64 overflow-hidden rounded-md border border-ops-border bg-ops-surface-raised shadow-2xl">
            <div className="border-b border-ops-border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ops-muted">
              {tNav("switchSite")}
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
                      ? "bg-ops-accent/12 text-ops-accent"
                      : "text-slate-600 hover:bg-ops-surface hover:text-ops-text dark:text-slate-400 dark:hover:text-white",
                  )}
                >
                  <span className={clsx("size-1.5 rounded-full", site.id === activeSite.id ? "bg-ops-accent" : "bg-slate-400 dark:bg-slate-600")} />
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
            <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ops-muted">{groupLabel(group)}</p>
            <div className="space-y-1">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} label={itemLabel(item)} active={isActive(item.href)} onNavigate={() => setMobileOpen(false)} />
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
          {tNav("profile")}
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
        <header className="sticky top-0 z-30 border-b border-ops-border bg-ops-bg/94 backdrop-blur-sm">
          <div className="flex h-14 items-center justify-between gap-3 px-4 lg:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="flex size-11 items-center justify-center rounded-md border border-ops-border bg-ops-surface text-ops-muted lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="size-5" />
              </button>

              <div className="hidden items-center gap-2 text-xs text-ops-muted xl:flex">
                <span className="rounded-full border border-ops-border px-2.5 py-1">{activeSite.name || tNav("noActiveSite")}</span>
                <span>{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => switchLocale(otherLocale)}
                aria-label={tNav("switchLocale")}
                title={tNav("switchLocale")}
                className="flex size-9 items-center justify-center rounded-md border border-ops-border bg-ops-surface text-[11px] font-bold text-ops-muted transition-colors hover:border-ops-accent/50 hover:text-ops-text"
              >
                {otherLocale.toUpperCase()}
              </button>

              <ThemeToggle />

              <ActionButton href="/audit/new" size="sm" icon={<ClipboardCheck className="size-4" />}>
                <span className="hidden sm:inline">{tNav("newAudit")}</span>
              </ActionButton>

              <ActionButton
                href="/admin/incidents"
                size="icon"
                variant="ghost"
                icon={<Bell className="size-4" />}
                title="Notifications"
                aria-label="Notifications"
              />

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setUserOpen((value) => !value)}
                  aria-haspopup="menu"
                  aria-expanded={userOpen}
                  aria-controls="user-menu"
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
                    <div role="presentation" className="fixed inset-0 z-40" onClick={() => setUserOpen(false)} />
                    <div id="user-menu" className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-md border border-ops-border bg-ops-surface-raised shadow-2xl">
                      <div className="border-b border-ops-border px-4 py-3">
                        <p className="truncate text-sm font-semibold text-ops-text">{user.username}</p>
                        <p className="text-xs capitalize text-ops-muted">{user.role}</p>
                      </div>
                      <Link
                        href="/profile"
                        onClick={() => setUserOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-slate-600 hover:bg-ops-surface hover:text-ops-text dark:text-slate-300 dark:hover:text-white"
                      >
                        <User className="size-4" />
                        {tNav("profileSettings")}
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setUserOpen(false);
                          logout();
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-500/10 dark:text-red-400"
                      >
                        <LogOut className="size-4" />
                        {tNav("logOut")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        <main id="main-content" className="min-h-[calc(100vh-56px)]">{children}</main>
      </div>
    </div>
  );
}

function NavLink({
  item,
  label,
  active,
  onNavigate,
}: {
  item: NavItem;
  label: string;
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
          ? "border border-ops-accent/30 bg-ops-accent/12 text-ops-accent"
          : "text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}
