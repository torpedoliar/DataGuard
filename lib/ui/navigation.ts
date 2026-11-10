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
  { href: "/report/schedules", label: "Report Schedules", icon: "calendar-clock" },
];

const siemItems: NavItem[] = [
  { href: "/admin/siem", label: "SIEM", labelKey: "siem", ns: "Nav", icon: "shield-alert" },
];

const complianceItems: NavItem[] = [
  { href: "/compliance/threat-intel", label: "Threat Intelligence", icon: "shield-check" },
];

// EPDR monitor items are read-only and visible to site staff, admin and
// superadmin alike (C8); the rest of the Security group stays admin-only.
const epdrItems: NavItem[] = [
  { href: "/admin/epdr", label: "Endpoint Security", icon: "server-cog" },
  { href: "/admin/epdr/threats", label: "Threats", icon: "radar" },
];

const infrastructureItems: NavItem[] = [
  { href: "/admin", label: "Devices", labelKey: "devices", ns: "AdminMenu", icon: "server" },
  { href: "/admin/rack-manage", label: "Racks", labelKey: "racks", ns: "AdminMenu", icon: "boxes" },
  { href: "/admin/rack", label: "Rack Layout", labelKey: "rackLayout", ns: "AdminMenu", icon: "panel-top" },
  { href: "/admin/locations", label: "Locations", labelKey: "locations", ns: "AdminMenu", icon: "map-pin" },
];

const networkItems: NavItem[] = [
  { href: "/admin/network/vlans", label: "Network", labelKey: "network", ns: "AdminMenu", icon: "network" },
  { href: "/admin/network-docs", label: "Network Docs", ns: "AdminMenu", icon: "cable" },
  { href: "/admin/ncm", label: "NCM", ns: "AdminMenu", icon: "router" },
  { href: "/admin/ncm/fleet", label: "NCM Fleet", ns: "AdminMenu", icon: "waypoints" },
  { href: "/admin/ncm/history", label: "Change History", ns: "AdminMenu", icon: "history" },
];

const catalogItems: NavItem[] = [
  { href: "/admin/brands", label: "Brands", labelKey: "brands", ns: "AdminMenu", icon: "tag" },
  { href: "/admin/categories", label: "Categories", labelKey: "categories", ns: "AdminMenu", icon: "folder-tree" },
  { href: "/admin/audit-log", label: "Audit Log", labelKey: "auditLog", ns: "AdminMenu", icon: "scroll-text" },
  { href: "/admin/email-log", label: "Email Log", labelKey: "emailLog", ns: "AdminMenu", icon: "mail" },
];

/** Every admin-only item, flattened (kept for callers that need the full set). */
export const adminItems: NavItem[] = [...infrastructureItems, ...networkItems, ...catalogItems];

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

  const securityItems: NavItem[] = [...epdrItems];
  if (role === "admin" || role === "superadmin") {
    securityItems.unshift(...siemItems, ...complianceItems);
  }
  groups.push({ label: "Security", labelKey: "security", items: securityItems });

  if (role === "admin" || role === "superadmin") {
    groups.push(
      { label: "Infrastructure", labelKey: "infrastructure", items: infrastructureItems },
      { label: "Network", labelKey: "network", items: networkItems },
      { label: "Records", labelKey: "records", items: catalogItems },
    );
  }

  if (role === "superadmin") {
    groups.push({ label: "Global", labelKey: "global", items: superadminItems });
  }

  return groups;
}
