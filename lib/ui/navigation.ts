export type UserRole = "staff" | "admin" | "superadmin" | string;

export type NavItem = {
  href: string;
  label: string;
  icon: string;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

const operateItems: NavItem[] = [
  { href: "/checklist", label: "Dashboard", icon: "layout-dashboard" },
  { href: "/audit/new", label: "New Audit", icon: "clipboard-check" },
  { href: "/audit/scan", label: "QR Scanner", icon: "qr-code" },
  { href: "/grid", label: "Audit Grid", icon: "grid-3x3" },
];

const resolveItems: NavItem[] = [
  { href: "/admin/incidents", label: "Incidents", icon: "circle-alert" },
  { href: "/report", label: "Reports", icon: "chart-column" },
];

const adminItems: NavItem[] = [
  { href: "/admin", label: "Devices", icon: "server" },
  { href: "/admin/settings", label: "Settings", icon: "settings" },
  { href: "/admin/rack-manage", label: "Racks", icon: "boxes" },
  { href: "/admin/rack", label: "Rack Layout", icon: "panel-top" },
  { href: "/admin/network/vlans", label: "Network", icon: "network" },
  { href: "/admin/brands", label: "Brands", icon: "tag" },
  { href: "/admin/categories", label: "Categories", icon: "folder-tree" },
  { href: "/admin/locations", label: "Locations", icon: "map-pin" },
  { href: "/admin/audit-log", label: "Audit Log", icon: "history" },
];

const superadminItems: NavItem[] = [
  { href: "/admin/users", label: "Users", icon: "users" },
  { href: "/admin/sites", label: "Sites", icon: "building-2" },
  { href: "/admin/update", label: "System Update", icon: "download" },
];

export function getAppNavigation(role: UserRole): NavGroup[] {
  const groups: NavGroup[] = [
    { label: "Operate", items: operateItems },
    { label: "Resolve", items: resolveItems },
  ];

  if (role === "admin" || role === "superadmin") {
    groups.push({ label: "Admin", items: adminItems });
  }

  if (role === "superadmin") {
    groups.push({ label: "Global", items: superadminItems });
  }

  return groups;
}
