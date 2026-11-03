"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { routing } from "@/i18n/routing";
import {
  Boxes,
  Bell,
  Building2,
  Cable,
  CalendarClock,
  ChartColumn,
  Check,
  ChevronRight,
  ChevronsUpDown,
  CircleAlert,
  ClipboardCheck,
  Download,
  FolderTree,
  Grid3X3,
  History,
  Languages,
  LayoutDashboard,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelTop,
  QrCode,
  Router,
  ScrollText,
  Search,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SunMoon,
  Tag,
  User,
  Users,
  Waypoints,
  X,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { logout, switchSite } from "@/actions/auth";
import { getAppNavigation, type NavGroup, type NavItem } from "@/lib/ui/navigation";
import ActionButton from "@/components/ui/action-button";
import { ThemeToggle, applyTheme } from "@/components/ui/theme-toggle";
import CommandPalette, { type CommandItem } from "@/components/ui/command-palette";
import NcmFleetNavBadge from "@/components/admin/ncm-fleet-nav-badge";

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
  router: Router,
  waypoints: Waypoints,
  tag: Tag,
  "folder-tree": FolderTree,
  "map-pin": MapPin,
  history: History,
  "scroll-text": ScrollText,
  mail: Mail,
  users: Users,
  "building-2": Building2,
  settings: Settings,
  "shield-alert": ShieldAlert,
  "shield-check": ShieldCheck,
  download: Download,
  "calendar-clock": CalendarClock,
};

const COLLAPSE_KEY = "dg.sidebar.collapsed";

function getInitials(username: string) {
  return username.slice(0, 2).toUpperCase();
}

/** Strip a locale prefix ("/en/admin" -> "/admin") so matching works for every locale. */
function stripLocale(pathname: string) {
  for (const loc of routing.locales) {
    if (pathname === `/${loc}`) return "/";
    if (pathname.startsWith(`/${loc}/`)) return pathname.slice(loc.length + 1);
  }
  return pathname;
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const navigation = getAppNavigation(user.role);
  const path = stripLocale(pathname);

  useEffect(() => {
    // Restore the rail preference after hydration so SSR markup stays stable.
    const stored = window.localStorage.getItem(COLLAPSE_KEY) === "1";
    if (stored) setCollapsed(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      window.localStorage.setItem(COLLAPSE_KEY, value ? "0" : "1");
      return !value;
    });
  };

  const itemLabel = useCallback(
    (item: NavItem) => (item.labelKey ? (item.ns === "AdminMenu" ? tAdmin(item.labelKey) : tNav(item.labelKey)) : item.label),
    [tAdmin, tNav],
  );

  const groupLabel = useCallback((group: NavGroup) => (group.labelKey ? tNav(group.labelKey) : group.label), [tNav]);

  // Locale switcher: with localePrefix "as-needed" only the non-default
  // locale ("en") is URL-prefixed. Strip any prefix, then re-apply the
  // target prefix when it is not the default, preserving the current query.
  const switchLocale = (nextLocale: (typeof routing.locales)[number]) => {
    if (nextLocale === locale) return;
    let nextPath = stripLocale(pathname);
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

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const allItems = useMemo(() => navigation.flatMap((group) => group.items), [navigation]);

  // Longest matching href wins, so /admin/ncm/fleet does not also light up /admin/ncm.
  const activeHref = useMemo(() => {
    let best: string | null = null;
    for (const item of allItems) {
      const match = item.href === "/admin" ? path === "/admin" : path === item.href || path.startsWith(`${item.href}/`);
      if (match && (!best || item.href.length > best.length)) best = item.href;
    }
    return best;
  }, [allItems, path]);

  const breadcrumb = useMemo(() => {
    for (const group of navigation) {
      const item = group.items.find((entry) => entry.href === activeHref);
      if (item) return { group: groupLabel(group), item: itemLabel(item) };
    }
    return null;
  }, [navigation, activeHref, groupLabel, itemLabel]);

  const handleSwitchSite = (siteId: number) => {
    startTransition(async () => {
      await switchSite(siteId);
      setSiteOpen(false);
      window.location.reload();
    });
  };

  const commands: CommandItem[] = useMemo(() => {
    const pages: CommandItem[] = navigation.flatMap((group) =>
      group.items.map((item) => {
        const Icon = iconMap[item.icon] || Server;
        return {
          id: `nav:${item.href}`,
          label: itemLabel(item),
          group: tNav("pages"),
          hint: groupLabel(group),
          keywords: `${item.href} ${item.label}`,
          icon: <Icon />,
          run: () => router.push(item.href),
        };
      }),
    );
    const actions: CommandItem[] = [
      { id: "act:audit", label: tNav("newAudit"), group: tNav("quickActions"), icon: <ClipboardCheck />, run: () => router.push("/audit/new") },
      { id: "act:scan", label: tNav("qrScanner"), group: tNav("quickActions"), icon: <QrCode />, run: () => router.push("/audit/scan") },
      {
        id: "act:theme",
        label: "Toggle theme",
        group: tNav("quickActions"),
        keywords: "dark light mode tema",
        icon: <SunMoon />,
        run: () => applyTheme(!document.documentElement.classList.contains("dark")),
      },
      { id: "act:locale", label: tNav("switchLocale"), group: tNav("quickActions"), hint: otherLocale.toUpperCase(), icon: <Languages />, run: () => switchLocale(otherLocale) },
      { id: "act:profile", label: tNav("profileSettings"), group: tNav("quickActions"), icon: <User />, run: () => router.push("/profile") },
      ...(userSites.length > 1
        ? userSites
            .filter((site) => site.id !== activeSite.id)
            .map((site) => ({
              id: `site:${site.id}`,
              label: `${tNav("switchSite")}: ${site.name}`,
              group: tNav("quickActions"),
              hint: site.code,
              icon: <Building2 />,
              run: () => handleSwitchSite(site.id),
            }))
        : []),
      { id: "act:logout", label: tNav("logOut"), group: tNav("quickActions"), icon: <LogOut />, run: () => logout() },
    ];
    return [...actions, ...pages];
    // switchLocale/handleSwitchSite are recreated each render but only close over stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, itemLabel, groupLabel, tNav, router, otherLocale, userSites, activeSite.id]);

  const isRail = collapsed && !mobileOpen;

  const sidebar = (rail: boolean) => (
    <aside
      className={clsx(
        "flex h-full min-h-0 flex-col border-r border-ops-border bg-ops-surface",
        rail ? "items-center px-2 py-3" : "px-3 py-3",
      )}
    >
      {/* Brand */}
      <div className={clsx("flex h-10 items-center", rail ? "justify-center" : "justify-between gap-2 px-1.5")}>
        <Link href="/select-site" className="flex min-w-0 items-center gap-2.5" title={appSettings.appName}>
          {appSettings.logoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={appSettings.logoPath} alt={appSettings.appName} className="size-7 shrink-0 object-contain" />
          ) : (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-ops-accent text-ops-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.15)]">
              <Server className="size-4" />
            </span>
          )}
          {!rail && <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ops-text">{appSettings.appName}</span>}
        </Link>
        {!rail && !mobileOpen && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={tNav("collapseSidebar")}
            title={tNav("collapseSidebar")}
            className="hidden size-7 items-center justify-center rounded-md text-ops-subtle transition-colors hover:bg-ops-surface-raised hover:text-ops-text lg:flex"
          >
            <PanelLeftClose className="size-4" />
          </button>
        )}
        {mobileOpen && (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label={tNav("closeNavigation")}
            className="flex size-8 items-center justify-center rounded-md text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Site switcher */}
      <div className={clsx("relative mt-3", rail ? "w-full" : "")}>
        <button
          type="button"
          onClick={() => setSiteOpen((value) => !value)}
          disabled={isPending || userSites.length <= 1}
          aria-haspopup="listbox"
          aria-expanded={siteOpen}
          aria-controls="site-switcher-menu"
          title={activeSite.name || tNav("noSiteSelected")}
          className={clsx(
            "group flex w-full items-center rounded-lg border border-ops-border bg-ops-surface-raised text-left transition-colors enabled:hover:border-ops-border-strong disabled:cursor-default",
            rail ? "size-10 justify-center" : "gap-2.5 px-2.5 py-2",
          )}
        >
          <span className="relative flex size-6 shrink-0 items-center justify-center rounded-md border border-ops-border bg-ops-surface text-ops-muted">
            <Building2 className="size-3.5" />
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-ops-surface-raised bg-ops-success" aria-hidden />
          </span>
          {!rail && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] text-ops-subtle">{tNav("activeSite")}</span>
                <span className="block truncate text-[13px] font-medium text-ops-text">{activeSite.name || tNav("noSiteSelected")}</span>
              </span>
              {userSites.length > 1 && <ChevronsUpDown className="size-4 shrink-0 text-ops-subtle" />}
            </>
          )}
        </button>

        {siteOpen && userSites.length > 1 && (
          <>
            <div role="presentation" className="fixed inset-0 z-40" onClick={() => setSiteOpen(false)} />
            <div
              id="site-switcher-menu"
              role="listbox"
              className={clsx(
                "absolute z-50 w-64 origin-top-left animate-scale-in overflow-hidden rounded-lg border border-ops-border bg-ops-surface shadow-[var(--shadow-overlay)]",
                rail ? "left-full top-0 ml-2" : "left-0 top-full mt-1.5",
              )}
            >
              <div className="px-3 pb-1 pt-2.5 text-xs font-medium text-ops-subtle">{tNav("switchSite")}</div>
              <div className="max-h-64 overflow-y-auto p-1.5 pt-0">
                {userSites.map((site) => {
                  const current = site.id === activeSite.id;
                  return (
                    <button
                      key={site.id}
                      type="button"
                      role="option"
                      aria-selected={current}
                      onClick={() => handleSwitchSite(site.id)}
                      disabled={isPending || current}
                      className={clsx(
                        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                        current ? "text-ops-text" : "text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{site.name}</span>
                        <span className="block font-mono text-[11px] text-ops-subtle">{site.code}</span>
                      </span>
                      {current && <Check className="size-4 shrink-0 text-ops-accent" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav aria-label="Main" className={clsx("mt-4 min-h-0 flex-1 overflow-y-auto", rail ? "w-full space-y-3" : "-mx-1 space-y-4 px-1")}>
        {navigation.map((group, groupIndex) => (
          <div key={group.label}>
            {rail ? (
              groupIndex > 0 && <div className="mx-auto mb-3 h-px w-6 bg-ops-border" aria-hidden />
            ) : (
              <p className="mb-1 px-2.5 text-xs font-medium text-ops-subtle">{groupLabel(group)}</p>
            )}
            <div className="space-y-px">
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  label={itemLabel(item)}
                  active={activeHref === item.href}
                  rail={rail}
                >
                  {item.href === "/admin/ncm/fleet" && !rail && <NcmFleetNavBadge />}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className={clsx("mt-3 border-t border-ops-border pt-3", rail && "flex w-full flex-col items-center gap-1")}>
        {rail ? (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={tNav("expandSidebar")}
            title={tNav("expandSidebar")}
            className="flex size-9 items-center justify-center rounded-md text-ops-subtle transition-colors hover:bg-ops-surface-raised hover:text-ops-text"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        ) : (
          <Link
            href="/profile"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 transition-colors hover:bg-ops-surface-raised"
          >
            <Avatar user={user} className="size-7 text-[11px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ops-text">{user.username}</span>
              <span className="block text-[11px] capitalize text-ops-subtle">{user.role}</span>
            </span>
          </Link>
        )}
      </div>
    </aside>
  );

  return (
    <div className="min-h-dvh bg-ops-bg text-ops-text">
      <div
        className={clsx(
          "hidden transition-[width] duration-200 ease-out lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:block",
          isRail ? "lg:w-[60px]" : "lg:w-60",
        )}
      >
        {sidebar(isRail)}
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={tNav("closeNavigation")}
            className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full w-[min(17rem,86vw)] animate-slide-in-left shadow-[var(--shadow-overlay)]">{sidebar(false)}</div>
        </div>
      )}

      <div className={clsx("min-h-dvh transition-[padding] duration-200 ease-out", isRail ? "lg:pl-[60px]" : "lg:pl-60")}>
        <header className="sticky top-0 z-30 border-b border-ops-border bg-ops-bg/80 backdrop-blur-md supports-[backdrop-filter]:bg-ops-bg/70">
          <div className="flex h-14 items-center justify-between gap-3 px-4 lg:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="flex size-9 items-center justify-center rounded-md border border-ops-border bg-ops-surface text-ops-muted lg:hidden"
                aria-label={tNav("openNavigation")}
              >
                <Menu className="size-[18px]" />
              </button>

              <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-[13px] sm:flex">
                <span className="truncate text-ops-muted">{activeSite.name || tNav("noActiveSite")}</span>
                {breadcrumb && (
                  <>
                    <ChevronRight className="size-3.5 shrink-0 text-ops-subtle" aria-hidden />
                    <span className="truncate text-ops-muted">{breadcrumb.group}</span>
                    <ChevronRight className="size-3.5 shrink-0 text-ops-subtle" aria-hidden />
                    <span className="truncate font-medium text-ops-text" aria-current="page">{breadcrumb.item}</span>
                  </>
                )}
              </nav>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label={tNav("search")}
                className="flex h-9 items-center gap-2 rounded-md border border-ops-border bg-ops-surface px-2.5 text-[13px] text-ops-subtle transition-colors hover:border-ops-border-strong hover:text-ops-muted md:w-56"
              >
                <Search className="size-4 shrink-0" />
                <span className="hidden flex-1 text-left md:inline">{tNav("search")}…</span>
                <kbd className="hidden rounded border border-ops-border bg-ops-surface-raised px-1.5 font-mono text-[11px] text-ops-muted md:inline">⌘K</kbd>
              </button>

              <button
                type="button"
                onClick={() => switchLocale(otherLocale)}
                aria-label={tNav("switchLocale")}
                title={tNav("switchLocale")}
                className="hidden size-9 items-center justify-center rounded-md font-mono text-[11px] font-medium text-ops-muted transition-colors hover:bg-ops-surface-raised hover:text-ops-text sm:flex"
              >
                {otherLocale.toUpperCase()}
              </button>

              <ThemeToggle />

              <ActionButton
                href="/admin/incidents"
                size="icon"
                variant="ghost"
                icon={<Bell />}
                title={tNav("notifications")}
                aria-label={tNav("notifications")}
              />

              <div className="mx-1 hidden h-5 w-px bg-ops-border sm:block" aria-hidden />

              <ActionButton href="/audit/new" size="sm" icon={<ClipboardCheck />} className="hidden sm:inline-flex">
                {tNav("newAudit")}
              </ActionButton>

              <div className="relative ml-1">
                <button
                  type="button"
                  onClick={() => setUserOpen((value) => !value)}
                  aria-haspopup="menu"
                  aria-expanded={userOpen}
                  aria-controls="user-menu"
                  className="flex rounded-full ring-offset-2 ring-offset-ops-bg transition-shadow hover:ring-2 hover:ring-ops-border-strong"
                  title={user.username}
                >
                  <Avatar user={user} className="size-8 text-xs" />
                </button>

                {userOpen && (
                  <>
                    <div role="presentation" className="fixed inset-0 z-40" onClick={() => setUserOpen(false)} />
                    <div
                      id="user-menu"
                      role="menu"
                      className="absolute right-0 top-full z-50 mt-2 w-60 origin-top-right animate-scale-in overflow-hidden rounded-lg border border-ops-border bg-ops-surface p-1.5 shadow-[var(--shadow-overlay)]"
                    >
                      <div className="flex items-center gap-2.5 px-2 py-2">
                        <Avatar user={user} className="size-8 text-xs" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ops-text">{user.username}</p>
                          <p className="text-xs capitalize text-ops-muted">{user.role}</p>
                        </div>
                      </div>
                      <div className="my-1 h-px bg-ops-border" />
                      <Link
                        href="/profile"
                        role="menuitem"
                        onClick={() => setUserOpen(false)}
                        className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-ops-muted transition-colors hover:bg-ops-surface-raised hover:text-ops-text"
                      >
                        <User className="size-4" />
                        {tNav("profileSettings")}
                      </Link>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setUserOpen(false);
                          setPaletteOpen(true);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-ops-muted transition-colors hover:bg-ops-surface-raised hover:text-ops-text"
                      >
                        <Search className="size-4" />
                        <span className="flex-1">{tNav("search")}</span>
                        <kbd className="font-mono text-[11px] text-ops-subtle">⌘K</kbd>
                      </button>
                      <div className="my-1 h-px bg-ops-border" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setUserOpen(false);
                          logout();
                        }}
                        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-ops-danger transition-colors hover:bg-ops-danger-soft"
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

        <main id="main-content" className="min-h-[calc(100dvh-56px)]">{children}</main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={commands}
        placeholder={tNav("searchPlaceholder")}
        emptyLabel={tNav("noResults")}
      />
    </div>
  );
}

function Avatar({ user, className }: { user: AppShellProps["user"]; className?: string }) {
  return (
    <span
      className={clsx(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-ops-border bg-ops-surface-raised font-semibold text-ops-muted",
        className,
      )}
    >
      {user.photoPath ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.photoPath} alt="" className="h-full w-full object-cover" />
      ) : (
        getInitials(user.username)
      )}
    </span>
  );
}

function NavLink({
  item,
  label,
  active,
  rail,
  children,
}: {
  item: NavItem;
  label: string;
  active: boolean;
  rail: boolean;
  children?: React.ReactNode;
}) {
  const Icon = iconMap[item.icon] || Server;

  return (
    <Link
      href={item.href}
      title={rail ? label : undefined}
      aria-label={rail ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "group relative flex items-center rounded-md text-[13px] font-medium transition-colors",
        rail ? "mx-auto size-10 justify-center" : "h-8 gap-2.5 px-2.5",
        active ? "bg-ops-surface-raised text-ops-text" : "text-ops-muted hover:bg-ops-surface-raised/70 hover:text-ops-text",
      )}
    >
      {active && !rail && <span aria-hidden className="absolute -left-1 top-1.5 bottom-1.5 w-0.5 rounded-full bg-ops-accent" />}
      <Icon className={clsx("size-4 shrink-0 transition-colors", active ? "text-ops-accent" : "text-ops-subtle group-hover:text-ops-muted")} />
      {!rail && <span className="truncate">{label}</span>}
      {children}
    </Link>
  );
}
