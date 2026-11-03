import { getCategories, getDevices } from "@/actions/master-data";
import DeviceManagement from "@/components/admin/device-management";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import { hasAdminAccess } from "@/lib/site-access";
import {
  Boxes,
  ChevronRight,
  Building2,
  CircleAlert,
  DatabaseBackup,
  FileSearch,
  FolderTree,
  MapPin,
  Network,
  PanelTop,
  RadioTower,
  Router,
  ScrollText,
  Server,
  Settings,
  ShieldAlert,
  Tag,
  Users,
  Mail,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

type Shortcut = {
  href: string;
  label: string;
  meta: string;
  icon: ReactNode;
};

/**
 * Normalize one dashboard dataset so a single failing source (DB outage,
 * migration window) degrades to an empty list instead of a whole-page 500.
 * All four fetches run in parallel below via Promise.allSettled.
 */
function readSettled<T>(result: PromiseSettledResult<T[]>): T[] {
  if (result.status === "rejected") {
    console.error("Failed to load admin dashboard dataset, degrading to empty:", result.reason);
    return [];
  }
  return Array.isArray(result.value) ? result.value : [];
}

function ShortcutGroup({ title, items }: { title: string; items: Shortcut[] }) {
  return (
    <section>
      <h2 className="mb-1.5 px-2 text-xs font-medium text-ops-subtle">{title}</h2>
      <div className="space-y-px">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-ops-surface-raised"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-ops-border bg-ops-surface text-ops-muted transition-colors group-hover:border-ops-accent/30 group-hover:text-ops-accent [&_svg]:size-4">
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ops-text">{item.label}</span>
              <span className="block truncate text-xs text-ops-muted">{item.meta}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-ops-subtle opacity-0 transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:opacity-100" />
          </Link>
        ))}
      </div>
    </section>
  );
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ deviceId?: string }> }) {
  const { parseDeviceProfileId } = await import("@/lib/device-profile-url");
  const initialDeviceId = parseDeviceProfileId((await searchParams).deviceId);
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

  // Fetch all four datasets in parallel. One failing source (e.g. DB down
  // during a migration) degrades to an empty list instead of a hard 500 —
  // getLocations already catches internally, the other three may throw.
  const [categoriesResult, devicesResult, brandsResult, locationsResult] = await Promise.allSettled([
    getCategories(),
    getDevices(),
    import("@/actions/brands").then((m) => m.getBrands()),
    import("@/actions/locations").then((m) => m.getLocations()),
  ]);
  const categories = readSettled(categoriesResult);
  const devices = readSettled(devicesResult);
  const brands = readSettled(brandsResult);
  const locations = readSettled(locationsResult);

  const inventoryShortcuts: Shortcut[] = [
    { href: "/admin/categories", label: "Categories", meta: "Device taxonomy", icon: <FolderTree className="size-5" /> },
    { href: "/admin/brands", label: "Brands", meta: "Vendors and logos", icon: <Tag className="size-5" /> },
    { href: "/admin/locations", label: "Locations", meta: "Rooms and areas", icon: <MapPin className="size-5" /> },
  ];

  const infrastructureShortcuts: Shortcut[] = [
    { href: "/admin/rack-manage", label: "Racks", meta: "Capacity registry", icon: <Boxes className="size-5" /> },
    { href: "/admin/rack", label: "Rack Layout", meta: "Visual placement", icon: <PanelTop className="size-5" /> },
    { href: "/admin/network/vlans", label: "VLANs", meta: "Network segments", icon: <Network className="size-5" /> },
    { href: "/admin/ncm", label: "NCM", meta: "Switch backups, baselines, drift reviews", icon: <Router className="size-5" /> },
  ];

  const siemShortcuts: Shortcut[] = [
    { href: "/admin/siem", label: "SIEM Dashboard", meta: "Syslog security overview", icon: <ShieldAlert className="size-5" /> },
    { href: "/admin/siem/syslog", label: "Syslog Messages", meta: "Device logs, severity, facility", icon: <ScrollText className="size-5" /> },
    { href: "/admin/siem/findings", label: "SIEM Findings", meta: "Rule detections", icon: <ShieldAlert className="size-5" /> },
    { href: "/admin/siem/events", label: "SIEM Events", meta: "Syslog event explorer", icon: <FileSearch className="size-5" /> },
    { href: "/admin/siem/sources", label: "SIEM Sources", meta: "Syslog source mapping", icon: <RadioTower className="size-5" /> },
  ];

  const governanceShortcuts: Shortcut[] = [
    { href: "/admin/incidents", label: "Incidents", meta: "Remediation queue", icon: <CircleAlert className="size-5" /> },
    { href: "/admin/users", label: "Users", meta: "Roles and access", icon: <Users className="size-5" /> },
    { href: "/admin/device-groups", label: "PIC Groups", meta: "Device responsibility groups", icon: <Users className="size-5" /> },
    { href: "/admin/email-log", label: "Email Log", meta: "PIC alert email history", icon: <Mail className="size-5" /> },
    { href: "/admin/settings", label: "Settings", meta: "Telegram and app config", icon: <Settings className="size-5" /> },
  ];

  if (session.role === "superadmin") {
    governanceShortcuts.push({ href: "/admin/sites", label: "Sites", meta: "Multi-site scope", icon: <Building2 className="size-5" /> });
    governanceShortcuts.push({ href: "/admin/backup", label: "Backup & Restore", meta: "Migrasi server", icon: <DatabaseBackup className="size-5" /> });
  }

  return (
    <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader
        eyebrow="Admin / Inventory"
        title="Device management"
        description={session.activeSiteName ? `Inventory for ${session.activeSiteName}.` : "Manage data center devices, rack placement, and supporting inventory data."}
        actions={
          <div className="inline-flex h-9 items-center gap-2 rounded-md border border-ops-border bg-ops-surface px-3 text-[13px] text-ops-muted">
            <Server className="size-4 text-ops-subtle" />
            <span className="font-medium tabular-nums text-ops-text">{devices.length}</span> devices
          </div>
        }
      />

      <details className="group ops-panel overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-ops-surface-raised/60 [&_summary::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Admin workspace</span>
            <span className="mt-0.5 block text-[13px] text-ops-muted">Inventory, infrastructure, SIEM, and governance shortcuts.</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-ops-subtle transition-transform duration-200 group-open:rotate-90" />
        </summary>
        <div className="grid gap-x-6 gap-y-6 border-t border-ops-border p-5 md:grid-cols-2 xl:grid-cols-4">
          <ShortcutGroup title="Inventory" items={inventoryShortcuts} />
          <ShortcutGroup title="Infrastructure" items={infrastructureShortcuts} />
          <ShortcutGroup title="SIEM" items={siemShortcuts} />
          <ShortcutGroup title="Governance" items={governanceShortcuts} />
        </div>
      </details>
      {(await searchParams).deviceId && initialDeviceId === null && <p role="alert" className="rounded-md border border-ops-warning/25 bg-ops-warning-soft px-3 py-2.5 text-[13px] text-ops-warning">Device ID pada URL tidak valid.</p>}
      <DeviceManagement devices={devices} categories={categories} brands={brands} locations={locations} canEdit={await hasAdminAccess()} />
    </main>
  );
}
