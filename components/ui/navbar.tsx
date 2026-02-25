
"use client";

import Link from "next/link";
import { logout, switchSite } from "@/actions/auth";
import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";

type SiteInfo = { id: number; name: string; code: string };

export default function Navbar({
    user,
    activeSite,
    userSites,
    appSettings,
}: {
    user: { username: string; role: string };
    activeSite: { id: number | null; name: string | null };
    userSites: SiteInfo[];
    appSettings: { appName: string; logoPath: string | null };
}) {
    const [showSiteSwitcher, setShowSiteSwitcher] = useState(false);
    const [showAdminMenu, setShowAdminMenu] = useState(false);
    const [isPending, startTransition] = useTransition();
    const isAdmin = ["admin", "superadmin"].includes(user.role);
    const pathname = usePathname();

    const handleSwitchSite = (siteId: number) => {
        startTransition(async () => {
            await switchSite(siteId);
            setShowSiteSwitcher(false);
            window.location.reload();
        });
    };

    const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");

    const navLinkClass = (path: string) =>
        `text-sm font-medium transition-colors px-1 py-0.5 ${isActive(path)
            ? "text-blue-400"
            : "text-slate-400 hover:text-white"
        }`;

    return (
        <header className="sticky top-0 z-50 w-full border-b border-slate-800/80 bg-[#0b1120]/95 backdrop-blur-xl" suppressHydrationWarning>
            <div className="mx-auto max-w-[1600px] flex items-center justify-between h-14 px-5">
                {/* Left: Logo + Site + Nav */}
                <div className="flex items-center gap-6">
                    {/* Logo */}
                    <Link href="/select-site" className="flex items-center gap-2.5 shrink-0">
                        {appSettings.logoPath ? (
                            <img src={appSettings.logoPath} alt="App Logo" className="h-7 w-auto object-contain" />
                        ) : (
                            <div className="size-7 flex items-center justify-center rounded-lg bg-blue-500/20 text-blue-400">
                                <span className="material-symbols-outlined text-lg">shield</span>
                            </div>
                        )}
                        <span className="text-lg font-bold tracking-tight text-white font-display">{appSettings.appName}</span>
                    </Link>

                    {/* Site Switcher */}
                    {activeSite.name && (
                        <div className="relative">
                            <button
                                onClick={() => setShowSiteSwitcher(!showSiteSwitcher)}
                                disabled={isPending}
                                className="flex items-center gap-2 h-8 px-3 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium hover:border-slate-600 hover:text-white transition-all"
                            >
                                <span className="material-symbols-outlined text-[14px] text-blue-400">location_on</span>
                                <span className="max-w-[130px] truncate">{activeSite.name}</span>
                                {userSites.length > 1 && (
                                    <span className="material-symbols-outlined text-[14px] text-slate-500">expand_more</span>
                                )}
                            </button>

                            {showSiteSwitcher && userSites.length > 1 && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setShowSiteSwitcher(false)} />
                                    <div className="absolute top-full left-0 mt-2 w-56 bg-[#111827] rounded-xl shadow-2xl border border-slate-700 z-50 overflow-hidden">
                                        <div className="p-2.5 border-b border-slate-700/50">
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold px-1">Switch Site</p>
                                        </div>
                                        <div className="py-1 max-h-60 overflow-y-auto">
                                            {userSites.map(site => (
                                                <button
                                                    key={site.id}
                                                    onClick={() => handleSwitchSite(site.id)}
                                                    disabled={isPending || site.id === activeSite.id}
                                                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors ${site.id === activeSite.id
                                                        ? "bg-blue-500/10 text-blue-400 font-medium"
                                                        : "text-slate-300 hover:bg-slate-800"
                                                        }`}
                                                >
                                                    <span className={`size-1.5 rounded-full ${site.id === activeSite.id ? "bg-blue-400" : "bg-slate-600"}`} />
                                                    <div>
                                                        <div>{site.name}</div>
                                                        <div className="text-[10px] text-slate-500 font-mono">{site.code}</div>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Nav Links */}
                    <nav className="hidden md:flex items-center gap-5">
                        <Link href="/checklist" className={navLinkClass("/checklist")}>Dashboard</Link>
                        <Link href="/report" className={navLinkClass("/report")}>Reports</Link>
                        <Link href="/grid" className={navLinkClass("/grid")}>Grid View</Link>
                        {isAdmin && (
                            <div className="relative">
                                <button
                                    onClick={() => setShowAdminMenu(!showAdminMenu)}
                                    className={`text-sm font-medium transition-colors flex items-center gap-1 ${isActive("/admin") ? "text-blue-400" : "text-slate-400 hover:text-white"}`}
                                >
                                    Admin
                                    <span className="material-symbols-outlined text-[16px]">expand_more</span>
                                </button>
                                {showAdminMenu && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setShowAdminMenu(false)} />
                                        <div className="absolute top-full left-0 mt-2 w-52 bg-[#111827] rounded-xl shadow-2xl border border-slate-700 z-50 overflow-hidden py-1.5">
                                            {[
                                                { href: "/admin", icon: "dns", label: "Devices" },
                                                { href: "/admin/brands", icon: "local_offer", label: "Brands" },
                                                { href: "/admin/categories", icon: "category", label: "Categories" },
                                                { href: "/admin/locations", icon: "pin_drop", label: "Locations" },
                                                { href: "/admin/rack-manage", icon: "view_in_ar", label: "Rack Management" },
                                                { href: "/admin/rack", icon: "grid_view", label: "Rack Layout" },
                                                { href: "/admin/network/vlans", icon: "hub", label: "VLANs" },
                                                { href: "/admin/users", icon: "group", label: "Users" },
                                            ].map(item => (
                                                <Link
                                                    key={item.href}
                                                    href={item.href}
                                                    onClick={() => setShowAdminMenu(false)}
                                                    className={`flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors ${isActive(item.href) ? "text-blue-400 bg-blue-500/5" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">{item.icon}</span>
                                                    {item.label}
                                                </Link>
                                            ))}
                                            {user.role === "superadmin" && (
                                                <>
                                                    <div className="border-t border-slate-700/50 my-1" />
                                                    <Link
                                                        href="/admin/sites"
                                                        onClick={() => setShowAdminMenu(false)}
                                                        className={`flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors ${isActive("/admin/sites") ? "text-blue-400 bg-blue-500/5" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">domain</span>
                                                        Site Management
                                                    </Link>
                                                    <Link
                                                        href="/admin/settings"
                                                        onClick={() => setShowAdminMenu(false)}
                                                        className={`flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors ${isActive("/admin/settings") ? "text-blue-400 bg-blue-500/5" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">settings</span>
                                                        Global Settings
                                                    </Link>
                                                </>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </nav>
                </div>

                {/* Right: Search + Actions */}
                <div className="flex items-center gap-4">
                    {/* Search */}
                    <div className="hidden lg:flex items-center relative">
                        <span className="material-symbols-outlined absolute left-3 text-slate-500 text-[18px]">search</span>
                        <input
                            className="h-9 w-56 rounded-full bg-slate-800/80 border border-slate-700 pl-9 pr-4 text-sm text-white placeholder-slate-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none"
                            placeholder="Search by ID..."
                            type="text"
                        />
                    </div>

                    {/* New Audit */}
                    <Link
                        href="/audit/new"
                        className="flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500 transition-all active:scale-95"
                    >
                        <span className="material-symbols-outlined text-[18px]">add</span>
                        <span className="hidden sm:inline">New Audit</span>
                    </Link>

                    {/* User Avatar */}
                    <button
                        onClick={() => logout()}
                        className="relative size-9 rounded-full overflow-hidden border-2 border-slate-700 hover:border-blue-500 transition-colors shrink-0"
                        title={`Logout (${user.username})`}
                    >
                        <div className="h-full w-full bg-slate-700 flex items-center justify-center text-white text-xs font-bold">
                            {user.username.substring(0, 2).toUpperCase()}
                        </div>
                    </button>
                </div>
            </div>
        </header>
    );
}
