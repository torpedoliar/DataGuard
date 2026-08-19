export type UserRole = "staff" | "admin" | "superadmin" | string;

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** next-intl key used to localize the label at render time. Falls back to `label` when absent. */
  labelKey?: string;
  /** i18n message namespace for `labelKey`. Defaults to "Nav" when unset. */
  ns?: "Nav" | "AdminMenu";
};

export type NavGroup = {
  label: string;
  /** next-intl "Nav" namespace key for this group header. Falls back to `label`. */
  labelKey?: string;
  items: NavItem[];
};

const operateItems: NavItem[] = [
  { href: "/checklist", label: "Dashboard", labelKey: "dashboard", ns: "Nav", icon: "layout-dashboard" },
  { href: "/audit/new", label: "New Audit", labelKey: "newAudit", ns: "Nav", icon: "clipboard-check" },
  { href: "/audit/scan", label: "QR Scanner", labelKey: "qrScanner", ns: "Nav", icon: "qr-code" },
  { href: "/grid", label: "Audit Grid", labelKey: "auditGrid", ns: "Nav", icon: "grid-3x3" },
];

const resolveItems: NavItem[] = [
  { href: "/admin/incidents", label: "Incidents", labelKey: "incidents", ns: "Nav", icon: "circle-alert" },
  { href: "/report", label: "Reports", labelKey: "reports", ns: "Nav", icon: "chart-column" },
];

const siemItems: NavItem[] = [
  { href: "/admin/siem", label: "SIEM", labelKey: "siem", ns: "Nav", icon: "shield-alert" },
];

const adminItems: NavItem[] = [
  { href: "/admin", label: "Devices", labelKey: "devices", ns: "AdminMenu", icon: "server" },
  { href: "/admin/rack-manage", label: "Racks", labelKey: "racks", ns: "AdminMenu", icon: "boxes" },
  { href: "/admin/rack", label: "Rack Layout", labelKey: "rackLayout", ns: "AdminMenu", icon: "panel-top" },
  { href: "/admin/network/vlans", label: "Network", labelKey: "network", ns: "AdminMenu", icon: "network" },
  { href: "/admin/network-docs", label: "Network Docs", ns: "AdminMenu", icon: "cable" },
  { href: "/admin/brands", label: "Brands", labelKey: "brands", ns: "AdminMenu", icon: "tag" },
  { href: "/admin/categories", label: "Categories", labelKey: "categories", ns: "AdminMenu", icon: "folder-tree" },
  { href: "/admin/locations", label: "Locations", labelKey: "locations", ns: "AdminMenu", icon: "map-pin" },
  { href: "/admin/audit-log", label: "Audit Log", labelKey: "auditLog", ns: "AdminMenu", icon: "history" },
];

const superadminItems: NavItem[] = [
  { href: "/admin/settings", label: "Settings", labelKey: "settings", ns: "AdminMenu", icon: "settings" },
  { href: "/admin/users", label: "Users", labelKey: "users", ns: "AdminMenu", icon: "users" },
  { href: "/admin/sites", label: "Sites", labelKey: "sites", ns: "AdminMenu", icon: "building-2" },
  { href: "/admin/update", label: "System Update", labelKey: "systemUpdate", ns: "AdminMenu", icon: "download" },
];

export function getAppNavigation(role: UserRole): NavGroup[] {
  const groups: NavGroup[] = [
    { label: "Operate", labelKey: "operate", items: operateItems },
    { label: "Resolve", labelKey: "resolve", items: resolveItems },
  ];

  if (role === "admin" || role === "superadmin") {
    groups.push({ label: "SIEM", labelKey: "siem", items: siemItems });
  }

  if (role === "admin" || role === "superadmin") {
    groups.push({ label: "Admin", labelKey: "admin", items: adminItems });
  }

  if (role === "superadmin") {
    groups.push({ label: "Global", labelKey: "global", items: superadminItems });
  }

  return groups;
}
